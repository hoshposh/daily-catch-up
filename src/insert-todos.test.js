import { describe, expect, test } from "vitest";
import { dedupeAgainstExisting, verifyTodosPresent } from "./insert-todos";

describe("dedupeAgainstExisting", () => {
  test("drops a todo that already exists in the note", () => {
    const result = dedupeAgainstExisting(
      ["- [ ] Standup", "- [ ] Email Sam"],
      "## Tasks\n- [ ] Standup\n"
    );
    expect(result).toStrictEqual({
      todos: ["- [ ] Email Sam"],
      skipped: 1,
      duplicates: ["- [ ] Standup"],
    });
  });

  test("compares trimmed lines, so indentation and trailing spaces do not matter", () => {
    const result = dedupeAgainstExisting(
      ["    - [ ] Standup  "],
      "- [ ] Standup\n"
    );
    expect(result).toStrictEqual({
      todos: [],
      skipped: 1,
      duplicates: ["    - [ ] Standup  "],
    });
  });

  test("handles CRLF in the existing note", () => {
    const result = dedupeAgainstExisting(["- [ ] Standup"], "- [ ] Standup\r\n- [ ] b\r\n");
    expect(result.todos).toStrictEqual([]);
  });

  test("the checkbox state is part of the comparison", () => {
    const result = dedupeAgainstExisting(["- [ ] Standup"], "- [x] Standup\n");
    expect(result).toStrictEqual({
      todos: ["- [ ] Standup"],
      skipped: 0,
      duplicates: [],
    });
  });

  test("drops a duplicate parent together with children that are also already in the note", () => {
    const result = dedupeAgainstExisting(
      ["- [ ] Standup", "    - [ ] prep notes", "    - remember agenda", "- [ ] Email Sam"],
      "- [ ] Standup\n    - [ ] prep notes\n    - remember agenda\n"
    );
    expect(result).toStrictEqual({
      todos: ["- [ ] Email Sam"],
      skipped: 3,
      duplicates: ["- [ ] Standup", "    - [ ] prep notes", "    - remember agenda"],
    });
  });

  test("keeps a duplicate parent whose children are not all in the note, so nothing is lost", () => {
    const todos = ["- [ ] Standup", "    - [ ] ask Bob about the deploy"];
    const result = dedupeAgainstExisting(todos, "- [ ] Standup\n");
    expect(result).toStrictEqual({ todos, skipped: 0, duplicates: [] });
  });

  test("keeps a duplicate child under a parent that is not a duplicate", () => {
    const result = dedupeAgainstExisting(
      ["- [ ] Ship release", "    - [ ] Standup"],
      "- [ ] Standup\n"
    );
    expect(result).toStrictEqual({
      todos: ["- [ ] Ship release", "    - [ ] Standup"],
      skipped: 0,
      duplicates: [],
    });
  });

  test("never drops plain text lines on their own", () => {
    const result = dedupeAgainstExisting(
      ["- [ ] Ship release", "    - notes"],
      "    - notes\n"
    );
    expect(result.todos).toStrictEqual(["- [ ] Ship release", "    - notes"]);
  });

  test("an indented open todo rolled on its own is compared as its own todo", () => {
    const result = dedupeAgainstExisting(
      ["    - [ ] nested a", "    - [ ] nested b"],
      "- [ ] nested a\n"
    );
    expect(result).toStrictEqual({
      todos: ["    - [ ] nested b"],
      skipped: 1,
      duplicates: ["    - [ ] nested a"],
    });
  });

  test("an empty todo is absorbed by an empty placeholder in the note", () => {
    const result = dedupeAgainstExisting(["- [ ]"], "## Tasks\n- [ ]\n");
    expect(result).toStrictEqual({ todos: [], skipped: 1, duplicates: ["- [ ]"] });
  });

  test("without children, an indented todo is its own item and is not dropped with its predecessor", () => {
    const result = dedupeAgainstExisting(
      ["- [ ] A", "    - [ ] B"],
      "- [ ] A\n",
      false
    );
    expect(result).toStrictEqual({
      todos: ["    - [ ] B"],
      skipped: 1,
      duplicates: ["- [ ] A"],
    });
  });

  test("returns the todos untouched when nothing matches", () => {
    const todos = ["- [ ] a", "    - [ ] b"];
    expect(dedupeAgainstExisting(todos, "nothing here")).toStrictEqual({
      todos,
      skipped: 0,
      duplicates: [],
    });
  });
});

describe("verifyTodosPresent", () => {
  test("true when every todo is a full line of the content", () => {
    expect(
      verifyTodosPresent("## Tasks\n- [ ] a\n    - [ ] b\n", ["- [ ] a", "    - [ ] b"])
    ).toBe(true);
  });

  test("false when a todo is missing", () => {
    expect(verifyTodosPresent("## Tasks\n- [ ] a\n", ["- [ ] a", "- [ ] b"])).toBe(false);
  });

  test("a partial match inside a longer line does not count", () => {
    expect(verifyTodosPresent("- [ ] a and more\n", ["- [ ] a"])).toBe(false);
  });

  test("works with CRLF line endings", () => {
    expect(verifyTodosPresent("## Tasks\r\n- [ ] a\r\n", ["- [ ] a"])).toBe(true);
  });

  test("true when there is nothing to verify", () => {
    expect(verifyTodosPresent("", [])).toBe(true);
  });

  test("false when the note was replaced by unrelated content", () => {
    expect(verifyTodosPresent("# 2026-10-21\n", ["- [ ] a"])).toBe(false);
  });
});

describe("verifyTodosPresent with a base note", () => {
  test("a rolled line that is also in the template must appear one more time", () => {
    const base = "## Tasks\n- [ ] Review inbox\n";
    const inserted = ["- [ ] Review inbox"];
    // Templater overwrote the note with the template: only the template's copy is left
    expect(verifyTodosPresent(base, inserted, base)).toBe(false);
    // Our copy survived next to the template's
    expect(
      verifyTodosPresent("## Tasks\n- [ ] Review inbox\n- [ ] Review inbox\n", inserted, base)
    ).toBe(true);
  });

  test("duplicates that were skipped must still be in the note", () => {
    const base = "- [ ] Standup\n";
    expect(verifyTodosPresent("- [ ] Standup\n", [], base, ["- [ ] Standup"])).toBe(true);
    expect(verifyTodosPresent("# rewritten\n", [], base, ["- [ ] Standup"])).toBe(false);
  });

  test("lines are compared after trimming", () => {
    expect(verifyTodosPresent("- [ ] Standup\n", [], "    - [ ] Standup\n", ["- [ ] Standup"])).toBe(true);
  });

  test("the same todo rolled twice must be present twice", () => {
    expect(verifyTodosPresent("- [ ] a\n", ["- [ ] a", "- [ ] a"])).toBe(false);
    expect(verifyTodosPresent("- [ ] a\n- [ ] a\n", ["- [ ] a", "- [ ] a"])).toBe(true);
  });
});
