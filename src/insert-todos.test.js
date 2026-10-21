import { describe, expect, test } from "vitest";
import { dedupeAgainstExisting } from "./insert-todos";

describe("dedupeAgainstExisting", () => {
  test("drops a todo that already exists in the note", () => {
    const result = dedupeAgainstExisting(
      ["- [ ] Standup", "- [ ] Email Sam"],
      "## Tasks\n- [ ] Standup\n"
    );
    expect(result).toStrictEqual({ todos: ["- [ ] Email Sam"], skipped: 1 });
  });

  test("compares trimmed lines, so indentation and trailing spaces do not matter", () => {
    const result = dedupeAgainstExisting(
      ["    - [ ] Standup  "],
      "- [ ] Standup\n"
    );
    expect(result).toStrictEqual({ todos: [], skipped: 1 });
  });

  test("handles CRLF in the existing note", () => {
    const result = dedupeAgainstExisting(["- [ ] Standup"], "- [ ] Standup\r\n- [ ] b\r\n");
    expect(result.todos).toStrictEqual([]);
  });

  test("the checkbox state is part of the comparison", () => {
    const result = dedupeAgainstExisting(["- [ ] Standup"], "- [x] Standup\n");
    expect(result).toStrictEqual({ todos: ["- [ ] Standup"], skipped: 0 });
  });

  test("drops the children of a duplicate parent along with it", () => {
    const result = dedupeAgainstExisting(
      ["- [ ] Standup", "    - [ ] prep notes", "    - remember agenda", "- [ ] Email Sam"],
      "- [ ] Standup\n"
    );
    expect(result).toStrictEqual({ todos: ["- [ ] Email Sam"], skipped: 3 });
  });

  test("keeps a duplicate child under a parent that is not a duplicate", () => {
    const result = dedupeAgainstExisting(
      ["- [ ] Ship release", "    - [ ] Standup"],
      "- [ ] Standup\n"
    );
    expect(result).toStrictEqual({
      todos: ["- [ ] Ship release", "    - [ ] Standup"],
      skipped: 0,
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
    expect(result).toStrictEqual({ todos: ["    - [ ] nested b"], skipped: 1 });
  });

  test("an empty todo is absorbed by an empty placeholder in the note", () => {
    const result = dedupeAgainstExisting(["- [ ]"], "## Tasks\n- [ ]\n");
    expect(result).toStrictEqual({ todos: [], skipped: 1 });
  });

  test("returns the todos untouched when nothing matches", () => {
    const todos = ["- [ ] a", "    - [ ] b"];
    expect(dedupeAgainstExisting(todos, "nothing here")).toStrictEqual({
      todos,
      skipped: 0,
    });
  });
});
