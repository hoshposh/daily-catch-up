import { describe, expect, test } from "vitest";
import {
  checkboxMarker,
  cumulativeDoneKeys,
  doneKeys,
  handledItemIds,
  isValidDay,
  lookBackApplies,
  lookBackDependenciesMet,
  lookBackDoneMarkers,
  nextLookBackSince,
  parseLookBackDays,
  parseLookBackSince,
  settledLookBackSince,
  todoKey,
} from "./look-back";

const on = {
  onRolloverSourceAction: "mark",
  skipExistingTodos: true,
  lookBackDays: 7,
};
const TODAY = "2026-11-21";

describe("lookBackApplies", () => {
  test("true with Mark or Delete, Skip existing and days", () => {
    expect(lookBackApplies(on)).toBe(true);
    expect(lookBackApplies({ ...on, onRolloverSourceAction: "delete" })).toBe(
      true
    );
  });
  test("false without a destructive or marking action", () => {
    expect(lookBackApplies({ ...on, onRolloverSourceAction: "none" })).toBe(
      false
    );
    expect(lookBackApplies({ ...on, onRolloverSourceAction: undefined })).toBe(
      false
    );
  });
  test("false without Skip existing todos", () => {
    expect(lookBackApplies({ ...on, skipExistingTodos: false })).toBe(false);
  });
  test("false for 0, missing or non-integer days", () => {
    expect(lookBackApplies({ ...on, lookBackDays: 0 })).toBe(false);
    expect(lookBackApplies({ ...on, lookBackDays: undefined })).toBe(false);
    expect(lookBackApplies({ ...on, lookBackDays: "7" })).toBe(false);
    expect(lookBackApplies({ ...on, lookBackDays: 1.5 })).toBe(false);
  });
  test("dependencies are met whatever the days", () => {
    expect(lookBackDependenciesMet({ ...on, lookBackDays: 0 })).toBe(true);
    expect(lookBackDependenciesMet({ ...on, skipExistingTodos: false })).toBe(
      false
    );
  });
});

describe("lookBackDoneMarkers", () => {
  test("are the effective done markers", () => {
    expect(lookBackDoneMarkers(on)).toBe("xX->");
    expect(
      lookBackDoneMarkers({
        ...on,
        doneStatusMarkers: "x",
        rolloverSourceMarker: "!",
      })
    ).toBe("x!");
  });
  test("an empty Done status markers field means the parser's default", () => {
    expect(
      lookBackDoneMarkers({
        ...on,
        onRolloverSourceAction: "delete",
        doneStatusMarkers: "",
      })
    ).toBe("xX-");
  });
});

describe("nextLookBackSince", () => {
  const stored = { ...on, lookBackSince: "2026-10-01" };
  const off = { ...stored, lookBackDays: 0 };
  test("off to on starts today", () => {
    expect(
      nextLookBackSince({ wasApplying: false, settings: on, today: TODAY })
    ).toBe("2026-11-21");
  });
  test("on to off clears it", () => {
    expect(
      nextLookBackSince({ wasApplying: true, settings: off, today: TODAY })
    ).toBe("");
  });
  test("on to on keeps it", () => {
    expect(
      nextLookBackSince({ wasApplying: true, settings: stored, today: TODAY })
    ).toBe("2026-10-01");
  });
  test("off to off keeps what is stored", () => {
    expect(
      nextLookBackSince({ wasApplying: false, settings: off, today: TODAY })
    ).toBe("2026-10-01");
    expect(
      nextLookBackSince({
        wasApplying: false,
        settings: { lookBackDays: 0 },
        today: TODAY,
      })
    ).toBe("");
  });
});

describe("nextLookBackSince when the done markers change", () => {
  const stored = { ...on, lookBackSince: "2026-10-01" };
  const next = (before, after) =>
    nextLookBackSince({
      wasApplying: true,
      previousDoneMarkers: lookBackDoneMarkers(before),
      settings: after,
      today: TODAY,
    });

  test("Mark to Delete starts today: the rollover marker is no longer done", () => {
    expect(next(stored, { ...stored, onRolloverSourceAction: "delete" })).toBe(
      TODAY
    );
  });
  test("a new rollover marker starts today", () => {
    expect(next(stored, { ...stored, rolloverSourceMarker: "!" })).toBe(TODAY);
  });
  test("a done marker removed starts today", () => {
    const before = { ...stored, doneStatusMarkers: "xX-" };
    expect(next(before, { ...before, doneStatusMarkers: "xX" })).toBe(TODAY);
  });
  test("a done marker added keeps the stored day", () => {
    const before = { ...stored, doneStatusMarkers: "xX-" };
    expect(next(before, { ...before, doneStatusMarkers: "xX-?" })).toBe(
      "2026-10-01"
    );
  });
  test("an unrelated change keeps the stored day", () => {
    expect(next(stored, { ...stored, lookBackDays: 14 })).toBe("2026-10-01");
  });
  test("emptying Done status markers loses nothing: the default applies", () => {
    const before = {
      ...stored,
      onRolloverSourceAction: "delete",
      doneStatusMarkers: "xX-",
    };
    expect(next(before, { ...before, doneStatusMarkers: "" })).toBe(
      "2026-10-01"
    );
  });
  test("a lost marker while Look back stops still clears it", () => {
    expect(next(stored, { ...stored, onRolloverSourceAction: "none" })).toBe(
      ""
    );
  });
});

describe("nextLookBackSince with a day remembered in this settings session", () => {
  // the day Read notes from held, and the done markers when it held it
  const remembered = { since: "2026-10-01", doneMarkers: "xX->" };
  const marking = { ...on, doneStatusMarkers: "xX-" };

  test("starting to apply again brings the remembered day back", () => {
    expect(
      nextLookBackSince({
        wasApplying: false,
        settings: marking,
        today: TODAY,
        remembered,
      })
    ).toBe("2026-10-01");
  });
  test("a done marker back again brings the remembered day back", () => {
    // Delete -> Mark: ">" counts again
    expect(
      nextLookBackSince({
        wasApplying: true,
        previousDoneMarkers: "xX-",
        settings: marking,
        today: TODAY,
        remembered: { since: "2026-10-01", doneMarkers: "xX-" },
      })
    ).toBe("2026-10-01");
  });
  test("still today while a remembered done marker is missing", () => {
    const deleting = { ...marking, onRolloverSourceAction: "delete" };
    // Mark -> Delete: ">" no longer counts
    expect(
      nextLookBackSince({
        wasApplying: true,
        previousDoneMarkers: "xX->",
        settings: deleting,
        today: TODAY,
        remembered,
      })
    ).toBe(TODAY);
    // starting to apply under Delete, after the day was set under Mark
    expect(
      nextLookBackSince({
        wasApplying: false,
        settings: deleting,
        today: TODAY,
        remembered,
      })
    ).toBe(TODAY);
  });
  test("stopping still clears it", () => {
    expect(
      nextLookBackSince({
        wasApplying: true,
        settings: { ...marking, lookBackDays: 0 },
        today: TODAY,
        remembered,
      })
    ).toBe("");
  });
  test("an invalid remembered day is not brought back", () => {
    expect(
      nextLookBackSince({
        wasApplying: false,
        settings: marking,
        today: TODAY,
        remembered: { since: "", doneMarkers: "xX->" },
      })
    ).toBe(TODAY);
  });
});

describe("settledLookBackSince", () => {
  test.each(["", "2026-13-40", "yesterday", undefined])(
    "applying with %j starts today",
    (lookBackSince) => {
      expect(settledLookBackSince({ ...on, lookBackSince }, TODAY)).toEqual({
        since: "2026-11-21",
        changed: true,
      });
    }
  );
  test("applying with a valid day changes nothing", () => {
    expect(
      settledLookBackSince({ ...on, lookBackSince: "2026-10-01" }, TODAY)
    ).toEqual({ since: "2026-10-01", changed: false });
  });
  test("not applying changes nothing", () => {
    expect(
      settledLookBackSince({ ...on, lookBackDays: 0, lookBackSince: "" }, TODAY)
    ).toEqual({ since: "", changed: false });
  });
});

test("isValidDay", () => {
  expect(isValidDay("2026-02-28")).toBe(true);
  expect(isValidDay("2026-02-30")).toBe(false);
  expect(isValidDay("2026-1-5")).toBe(false);
  expect(isValidDay(undefined)).toBe(false);
  expect(isValidDay("2024-02-29")).toBe(true);
});

test("parseLookBackDays", () => {
  expect(parseLookBackDays("7")).toBe(7);
  expect(parseLookBackDays(" 0 ")).toBe(0);
  expect(parseLookBackDays("366")).toBe(366);
  for (const bad of ["367", "-1", "1.5", "abc", ""]) {
    expect(parseLookBackDays(bad), bad).toBeUndefined();
  }
});

test("parseLookBackSince", () => {
  expect(parseLookBackSince("", TODAY)).toBe("2026-11-21");
  expect(parseLookBackSince(" 2026-11-01 ", TODAY)).toBe("2026-11-01");
  expect(parseLookBackSince("2026-11-21", TODAY)).toBe("2026-11-21");
  expect(parseLookBackSince("2026-11-22", TODAY)).toBeUndefined();
  expect(parseLookBackSince("2026-02-30", TODAY)).toBeUndefined();
  expect(parseLookBackSince("yesterday", TODAY)).toBeUndefined();
});

const DONE = "xX->";

describe("todoKey", () => {
  test("is the text after the checkbox, without the rolled counter", () => {
    expect(todoKey("- [ ] Call Sam [rolled:: 2]")).toBe("Call Sam");
    expect(todoKey("    * [x] Call Sam")).toBe("Call Sam");
    expect(todoKey("> 1. [>] Call Sam [rolled:: 5]")).toBe("Call Sam");
  });

  test("is null for a line that is not a checkbox", () => {
    expect(todoKey("- Call Sam")).toBeNull();
    expect(todoKey("Call Sam")).toBeNull();
  });

  test("is null for a bullet starting with a link or other brackets", () => {
    expect(todoKey("  - [[Sam Smith]] prefers mornings")).toBeNull();
    expect(todoKey("- [[]] x")).toBeNull();
    expect(todoKey("- [ab] x")).toBeNull();
    expect(todoKey("- [x]y")).toBeNull();
  });

  test("leaves out an Obsidian Tasks done or cancelled date", () => {
    expect(todoKey("- [x] Call Sam ✅ 2026-11-20")).toBe("Call Sam");
    expect(todoKey("- [-] Call Sam ❌ 2026-11-20")).toBe("Call Sam");
    expect(todoKey("- [x] Call Sam 📅 2026-11-25 ✅ 2026-11-20 ^abc")).toBe(
      "Call Sam 📅 2026-11-25 ^abc"
    );
    expect(todoKey("- [ ] Call Sam 📅 2026-11-25 ^abc")).toBe(
      "Call Sam 📅 2026-11-25 ^abc"
    );
  });

  test("takes an emoji status as one checkbox", () => {
    expect(todoKey("- [👍🏽] Call Sam")).toBe("Call Sam");
    expect(todoKey("- [👨‍👩‍👧] Call Sam")).toBe("Call Sam");
    expect(todoKey("- [x]")).toBe("");
  });
});

describe("checkboxMarker", () => {
  test("is what sits inside the brackets", () => {
    expect(checkboxMarker("- [ ] A")).toBe(" ");
    expect(checkboxMarker("  > * [x] A")).toBe("x");
  });

  test("is null for a line that is not a checkbox", () => {
    expect(checkboxMarker("- A")).toBeNull();
  });

  test("is null for brackets that are not a one-character checkbox", () => {
    expect(checkboxMarker("  - [[Sam Smith]] prefers mornings")).toBeNull();
    expect(checkboxMarker("- [[]] x")).toBeNull();
    expect(checkboxMarker("- [\u200B] x")).toBeNull();
  });
});

describe("doneKeys", () => {
  test("holds the key of every checkbox with a done marker", () => {
    const lines = ["- [x] A", "- [ ] B", "- [>] C", "- [-] D", "text"];
    expect(doneKeys(lines, DONE)).toEqual(new Set(["A", "C", "D"]));
  });

  test("a bullet starting with brackets is not done", () => {
    expect(doneKeys(["- [[]] x", "- [[Sam]] y"], DONE)).toEqual(new Set());
  });
});

describe("cumulativeDoneKeys", () => {
  test("entry k holds the done keys of the notes before k", () => {
    expect(
      cumulativeDoneKeys([["- [x] A"], ["- [x] B"], ["- [ ] C"]], DONE)
    ).toEqual([new Set(), new Set(["A"]), new Set(["A", "B"])]);
  });
});

describe("handledItemIds", () => {
  const item = (id, ...lines) => ({ id, lines });

  test("an item whose head is done in a newer note is handled", () => {
    const items = [item("0:0", "- [ ] Call Sam [rolled:: 2]")];
    expect(handledItemIds(items, new Set(["Call Sam"]), DONE)).toEqual(
      new Set(["0:0"])
    );
  });

  test("a head not done in a newer note is not handled", () => {
    const items = [item("0:0", "- [ ] Call Sam")];
    expect(handledItemIds(items, new Set(["Other"]), DONE)).toEqual(new Set());
  });

  test("an open nested todo not done in a newer note blocks it", () => {
    const items = [item("0:0", "- [ ] A", "  - [ ] sub")];
    expect(handledItemIds(items, new Set(["A"]), DONE)).toEqual(new Set());
  });

  test("an open nested todo done in a newer note too does not block", () => {
    const items = [item("0:0", "- [ ] A", "  - [ ] sub")];
    expect(handledItemIds(items, new Set(["A", "sub"]), DONE)).toEqual(
      new Set(["0:0"])
    );
  });

  test("a copy completed with Obsidian Tasks counts as done", () => {
    const keys = doneKeys(["- [x] Call Sam ✅ 2026-11-20"], DONE);
    const items = [item("0:0", "- [ ] Call Sam")];
    expect(handledItemIds(items, keys, DONE)).toEqual(new Set(["0:0"]));
  });

  test("a nested bullet starting with a link does not block", () => {
    const items = [
      item("0:0", "- [ ] A", "  - [[Sam Smith]] prefers mornings"),
    ];
    expect(handledItemIds(items, new Set(["A"]), DONE)).toEqual(
      new Set(["0:0"])
    );
  });

  test("a nested plain bullet or completed child does not block", () => {
    const items = [item("0:0", "- [ ] A", "  - note", "  - [x] done child")];
    expect(handledItemIds(items, new Set(["A"]), DONE)).toEqual(
      new Set(["0:0"])
    );
  });

  test("a done copy only in an older note does not count for the note above it", () => {
    const [forNewest, forMiddle, forOldest] = cumulativeDoneKeys(
      [["- [ ] A"], ["- [ ] B"], ["- [x] A"]],
      DONE
    );
    const items = [item("0:0", "- [ ] A")];
    // the done copy is in the oldest note: only notes newer than it see it
    expect(handledItemIds(items, forNewest, DONE)).toEqual(new Set());
    expect(handledItemIds(items, forMiddle, DONE)).toEqual(new Set());
    expect(handledItemIds(items, forOldest, DONE)).toEqual(new Set());
  });
});
