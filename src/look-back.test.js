import { describe, expect, test } from "vitest";
import {
  checkboxMarker,
  cumulativeDoneKeys,
  doneKeys,
  handledItemIds,
  isValidDay,
  lookBackApplies,
  lookBackDependenciesMet,
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
