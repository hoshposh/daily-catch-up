import { describe, expect, test } from "vitest";
import {
  fromNote,
  insertField,
  parseRolledCount,
  setRolledCount,
  stripFromField,
  stripRolledCount,
} from "./rolled-count";

describe("parseRolledCount", () => {
  test("reads the number", () =>
    expect(parseRolledCount("- [ ] a [rolled:: 3]")).toBe(3));
  test("missing field is 0", () => expect(parseRolledCount("- [ ] a")).toBe(0));
  test("non-numeric field is 0", () =>
    expect(parseRolledCount("- [ ] a [rolled:: x]")).toBe(0));
});

describe("setRolledCount", () => {
  test("appends at the end", () =>
    expect(setRolledCount("- [ ] a", 1)).toBe("- [ ] a [rolled:: 1]"));
  test("replaces an existing field, numeric or not", () => {
    expect(setRolledCount("- [ ] a [rolled:: 2]", 3)).toBe(
      "- [ ] a [rolled:: 3]"
    );
    expect(setRolledCount("- [ ] a [rolled:: x]", 1)).toBe(
      "- [ ] a [rolled:: 1]"
    );
  });
  test("goes before a trailing block id", () =>
    expect(setRolledCount("- [ ] a ^abc-1", 1)).toBe(
      "- [ ] a [rolled:: 1] ^abc-1"
    ));
  test("goes before Tasks fields so Tasks still parses them", () =>
    expect(
      setRolledCount(
        "- [ ] Pay rent [rolled:: 2] 📅 2026-11-10 🔁 every month",
        3
      )
    ).toBe("- [ ] Pay rent [rolled:: 3] 📅 2026-11-10 🔁 every month"));
  test("keeps a trailing carriage return", () =>
    expect(setRolledCount("- [ ] a\r", 1)).toBe("- [ ] a [rolled:: 1]\r"));
  test("is idempotent for the same n", () => {
    const once = setRolledCount("- [ ] a ^id", 2);
    expect(setRolledCount(once, 2)).toBe(once);
  });
  test("searches for signifiers only after the checkbox", () =>
    expect(setRolledCount("- [✅] a", 1)).toBe("- [✅] a [rolled:: 1]"));
  test("keeps the field after a leading emoji with no other signifier", () =>
    expect(setRolledCount("- [ ] 📅 plan the week", 1)).toBe(
      "- [ ] 📅 plan the week [rolled:: 1]"
    ));
  test("skips a leading signifier and uses the next one", () =>
    expect(setRolledCount("- [ ] 📅 plan 📅 2026-11-10", 1)).toBe(
      "- [ ] 📅 plan [rolled:: 1] 📅 2026-11-10"
    ));
  test("matches a signifier followed by a variation selector", () =>
    expect(setRolledCount("- [ ] a ⏫️", 1)).toBe("- [ ] a [rolled:: 1] ⏫️"));
  test("goes before Tasks fields that come before a block id", () =>
    expect(setRolledCount("- [ ] a 📅 2026-11-10 ^id", 1)).toBe(
      "- [ ] a [rolled:: 1] 📅 2026-11-10 ^id"
    ));
});

describe("stripRolledCount", () => {
  test("removes the field and its space", () => {
    expect(stripRolledCount("- [ ] a [rolled:: 4] ^id")).toBe("- [ ] a ^id");
    expect(stripRolledCount("- [ ] a")).toBe("- [ ] a");
  });
  test("removes every field", () =>
    expect(stripRolledCount("- [ ] a [rolled:: 1] b [rolled:: x]")).toBe(
      "- [ ] a b"
    ));
});

describe("insertField", () => {
  test("uses the same insertion point", () =>
    expect(
      insertField("- [ ] a 📅 2026-11-10", "[from:: [[2026-11-06]]]")
    ).toBe("- [ ] a [from:: [[2026-11-06]]] 📅 2026-11-10"));
});

describe("a status character outside the Basic Multilingual Plane", () => {
  test("the counter goes after the checkbox, not into it", () => {
    expect(setRolledCount("- [📅] a", 1)).toBe("- [📅] a [rolled:: 1]");
    expect(setRolledCount("> - [🔥] a 📅 2026-11-10", 2)).toBe(
      "> - [🔥] a [rolled:: 2] 📅 2026-11-10"
    );
  });

  test("other fields go after the checkbox too", () => {
    expect(insertField("- [📅] a", "[from:: [[d]]]")).toBe(
      "- [📅] a [from:: [[d]]]"
    );
  });
});

describe("stripFromField", () => {
  test.each([
    ["- [ ] Learn Rust [from:: [[2026-11-01]]]", "- [ ] Learn Rust"],
    [
      "- [ ] Pay tax [from:: [[2026-11-01]]] 📅 2026-12-01",
      "- [ ] Pay tax 📅 2026-12-01",
    ],
    ["- [ ] Call Sam [from:: [[Inbox]]] ^abc", "- [ ] Call Sam ^abc"],
    ["- [ ] A [rolled:: 2] [from:: [[d]]]", "- [ ] A [rolled:: 2]"],
    ["- [ ] Mon [from:: [[2026-11-01|Monday]]]\r", "- [ ] Mon\r"],
    ["- [ ] Typed [from:: somewhere]", "- [ ] Typed"],
    ["- [ ] Plain", "- [ ] Plain"],
  ])("%s", (line, expected) => {
    expect(stripFromField(line)).toBe(expected);
  });
});

describe("fromNote", () => {
  test("the linked note", () => {
    expect(fromNote("- [ ] Learn Rust [from:: [[2026-11-01]]]")).toBe(
      "2026-11-01"
    );
  });
  test("an alias is left out", () => {
    expect(fromNote("- [ ] Mon [from:: [[2026-11-01|Monday]]]")).toBe(
      "2026-11-01"
    );
  });
  test("no field, or a field without a link", () => {
    expect(fromNote("- [ ] Plain")).toBeNull();
    expect(fromNote("- [ ] Typed [from:: somewhere]")).toBeNull();
  });
});
