import { describe, expect, test } from "vitest";
import {
  applySourceAction,
  effectiveDoneStatusMarkers,
  migrateSourceActionSettings,
  normalizeMarker,
  resolveSourceAction,
} from "./source-action";

describe("resolveSourceAction", () => {
  test("uses an explicit onRolloverSourceAction", () => {
    expect(resolveSourceAction({ onRolloverSourceAction: "mark" })).toBe("mark");
    expect(resolveSourceAction({ onRolloverSourceAction: "delete" })).toBe("delete");
    expect(resolveSourceAction({ onRolloverSourceAction: "none" })).toBe("none");
  });

  test("falls back to none for missing or unknown values", () => {
    expect(resolveSourceAction({})).toBe("none");
    expect(resolveSourceAction({ onRolloverSourceAction: "bogus" })).toBe("none");
  });
});

describe("migrateSourceActionSettings", () => {
  test("legacy deleteOnComplete: true becomes delete", () => {
    expect(
      migrateSourceActionSettings({ onRolloverSourceAction: "none" }, { deleteOnComplete: true })
        .onRolloverSourceAction
    ).toBe("delete");
  });

  test("legacy deleteOnComplete: false stays none", () => {
    expect(
      migrateSourceActionSettings({ onRolloverSourceAction: "none" }, { deleteOnComplete: false })
        .onRolloverSourceAction
    ).toBe("none");
  });

  test("an explicit stored action wins over the legacy flag", () => {
    const settings = { onRolloverSourceAction: "mark" };
    expect(
      migrateSourceActionSettings(settings, {
        deleteOnComplete: true,
        onRolloverSourceAction: "mark",
      }).onRolloverSourceAction
    ).toBe("mark");
  });
});

describe("normalizeMarker", () => {
  test("accepts a single non-space grapheme", () => {
    expect(normalizeMarker(">")).toBe(">");
    expect(normalizeMarker("➡️")).toBe("➡️");
  });

  test("falls back to > for empty, multi-character, or whitespace input", () => {
    expect(normalizeMarker("")).toBe(">");
    expect(normalizeMarker(undefined)).toBe(">");
    expect(normalizeMarker(" ")).toBe(">");
    expect(normalizeMarker("ab")).toBe(">");
  });
});

describe("effectiveDoneStatusMarkers", () => {
  test("adds the marker only when the action is mark", () => {
    const base = { doneStatusMarkers: "xX-", rolloverSourceMarker: ">" };
    expect(effectiveDoneStatusMarkers({ ...base, onRolloverSourceAction: "mark" })).toBe("xX->");
    expect(effectiveDoneStatusMarkers({ ...base, onRolloverSourceAction: "none" })).toBe("xX-");
    expect(effectiveDoneStatusMarkers({ ...base, onRolloverSourceAction: "delete" })).toBe("xX-");
  });

  test("an empty done-markers field keeps the parser defaults and adds the marker", () => {
    expect(
      effectiveDoneStatusMarkers({
        doneStatusMarkers: "",
        rolloverSourceMarker: ">",
        onRolloverSourceAction: "mark",
      })
    ).toBe("xX->");
  });

  test("does not duplicate a marker that is already a done marker", () => {
    expect(
      effectiveDoneStatusMarkers({
        doneStatusMarkers: "xX>",
        rolloverSourceMarker: ">",
        onRolloverSourceAction: "mark",
      })
    ).toBe("xX>");
  });
});

describe("applySourceAction: none", () => {
  test("leaves content untouched", () => {
    const content = "- [ ] a\n- [x] b";
    expect(applySourceAction({ content, action: "none", rolledTodos: ["- [ ] a"] })).toStrictEqual({
      content,
      changed: false,
    });
  });
});

describe("applySourceAction: delete", () => {
  test("removes rolled lines and keeps the rest", () => {
    const content = "## Work\n- [ ] a\n- [x] b\n- [ ] c";
    const result = applySourceAction({
      content,
      action: "delete",
      rolledTodos: ["- [ ] a", "- [ ] c"],
    });
    expect(result).toStrictEqual({ content: "## Work\n- [x] b", changed: true });
  });

  test("also removes lines listed in deletedTodos (e.g. empty todos that were not rolled)", () => {
    const content = "- [ ] a\n- [ ]\n- [x] b";
    const result = applySourceAction({
      content,
      action: "delete",
      rolledTodos: ["- [ ] a"],
      deletedTodos: ["- [ ] a", "- [ ]"],
    });
    expect(result.content).toBe("- [x] b");
  });

  test("removes skipped completed children by line index, not by text", () => {
    const content = [
      "## Work",
      "- [ ] parent",
      "    - [x] done child",
      "        - nested",
      "- [x] done child",
    ].join("\n");
    const result = applySourceAction({
      content,
      action: "delete",
      rolledTodos: ["- [ ] parent"],
      skippedLineIndices: [2, 3],
    });
    expect(result.content).toBe("## Work\n- [x] done child");
  });

  test("deletes on CRLF files, including the rolled lines themselves", () => {
    const content = "## Work\r\n- [ ] parent\r\n    - [x] done child\r\n- [x] kept\r\n";
    const result = applySourceAction({
      content,
      action: "delete",
      rolledTodos: ["- [ ] parent"],
      skippedLineIndices: [2],
    });
    expect(result.content).toBe("## Work\r\n- [x] kept\r\n");
  });

  test("drops headings left with no content", () => {
    const content = "## Work\n- [ ] a\n## Home\n- [x] b";
    const result = applySourceAction({
      content,
      action: "delete",
      rolledTodos: ["- [ ] a"],
    });
    expect(result.content).toBe("## Home\n- [x] b");
  });
});

describe("applySourceAction: mark", () => {
  const base = { action: "mark", marker: ">", doneStatusMarkers: "xX-" };

  test("marks a rolled open todo", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] a\n- [x] b",
      rolledTodos: ["- [ ] a"],
    });
    expect(result).toStrictEqual({ content: "- [>] a\n- [x] b", changed: true });
  });

  test("marks open children as well as their parent", () => {
    const rolled = ["- [ ] parent", "    - [ ] child"];
    const result = applySourceAction({
      ...base,
      content: rolled.join("\n"),
      rolledTodos: rolled,
    });
    expect(result.content).toBe("- [>] parent\n    - [>] child");
  });

  test("leaves rolled completed children as they were", () => {
    const rolled = ["- [ ] parent", "    - [x] done child", "    - plain note"];
    const result = applySourceAction({
      ...base,
      content: rolled.join("\n"),
      rolledTodos: rolled,
    });
    expect(result.content).toBe("- [>] parent\n    - [x] done child\n    - plain note");
  });

  test("marks custom in-progress statuses", () => {
    const result = applySourceAction({
      ...base,
      content: "- [/] half",
      rolledTodos: ["- [/] half"],
    });
    expect(result.content).toBe("- [>] half");
  });

  test("does not touch todos that were not rolled", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] rolled\n- [ ]\n- [ ] kept",
      rolledTodos: ["- [ ] rolled"],
    });
    expect(result.content).toBe("- [>] rolled\n- [ ]\n- [ ] kept");
  });

  test("works on CRLF files and keeps the line endings", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] a\r\n- [x] b\r\n",
      rolledTodos: ["- [ ] a"],
    });
    expect(result.content).toBe("- [>] a\r\n- [x] b\r\n");
  });

  test("supports multi-codepoint markers and $ in the marker", () => {
    expect(
      applySourceAction({ ...base, marker: "➡️", content: "- [ ] a", rolledTodos: ["- [ ] a"] })
        .content
    ).toBe("- [➡️] a");
    expect(
      applySourceAction({ ...base, marker: "$", content: "- [ ] a", rolledTodos: ["- [ ] a"] })
        .content
    ).toBe("- [$] a");
  });

  test("reports unchanged when nothing matched", () => {
    const result = applySourceAction({
      ...base,
      content: "- [x] b",
      rolledTodos: ["- [ ] a"],
    });
    expect(result).toStrictEqual({ content: "- [x] b", changed: false });
  });

  test("does not delete anything or touch headings", () => {
    const result = applySourceAction({
      ...base,
      content: "## Work\n- [ ] a",
      rolledTodos: ["- [ ] a"],
    });
    expect(result.content).toBe("## Work\n- [>] a");
  });
});
