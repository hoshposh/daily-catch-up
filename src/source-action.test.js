import { describe, expect, test, vi } from "vitest";
import { splitLines } from "./get-todos";
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

describe("normalizeMarker without Intl.Segmenter", () => {
  test("falls back to code points instead of throwing", async () => {
    const original = Intl.Segmenter;
    Intl.Segmenter = undefined;
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.resetModules();
      const { normalizeMarker: normalize } = await import("./source-action");
      expect(normalize(">")).toBe(">");
      expect(normalize("➡")).toBe("➡");
      expect(normalize("ab")).toBe(">");
    } finally {
      Intl.Segmenter = original;
      vi.restoreAllMocks();
      vi.resetModules();
    }
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
    expect(applySourceAction({ content, action: "none", rolledLineIndices: [0] })).toStrictEqual({
      content,
      changed: false,
    });
  });
});

describe("applySourceAction: delete", () => {
  test("removes the rolled lines by position and keeps the rest", () => {
    const content = "## Work\n- [ ] a\n- [x] b\n- [ ] c";
    const result = applySourceAction({
      content,
      action: "delete",
      rolledLineIndices: [1, 3],
    });
    expect(result).toStrictEqual({ content: "## Work\n- [x] b", changed: true });
  });

  test("keeps lines that only have the same text as a rolled line", () => {
    const content = "- [ ] parent A\n    - notes\n- [x] parent B\n    - notes";
    const result = applySourceAction({
      content,
      action: "delete",
      rolledLineIndices: [0, 1],
    });
    expect(result.content).toBe("- [x] parent B\n    - notes");
  });

  test("keeps an identical line inside a code block", () => {
    const content = "- [ ] a\n```\n- [ ] a\n```";
    const result = applySourceAction({
      content,
      action: "delete",
      rolledLineIndices: [0],
    });
    expect(result.content).toBe("```\n- [ ] a\n```");
  });

  test("also removes deletedLineIndices (e.g. empty todos that were not rolled)", () => {
    const content = "- [ ] a\n- [ ]\n- [x] b";
    const result = applySourceAction({
      content,
      action: "delete",
      rolledLineIndices: [0],
      deletedLineIndices: [0, 1],
    });
    expect(result.content).toBe("- [x] b");
  });

  test("removes skipped completed children together with the rolled parent", () => {
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
      rolledLineIndices: [1],
      skippedLineIndices: [2, 3],
    });
    expect(result.content).toBe("## Work\n- [x] done child");
  });

  test("works on CRLF files and keeps their line endings", () => {
    const content = "## Work\r\n- [ ] parent\r\n    - [x] done child\r\n- [x] kept\r\n";
    const result = applySourceAction({
      content,
      action: "delete",
      rolledLineIndices: [1],
      skippedLineIndices: [2],
    });
    expect(result.content).toBe("## Work\r\n- [x] kept\r\n");
  });

  test("positions found with splitLines agree with the note's lines, whatever the line endings", () => {
    const content = "a\r\n- [ ] x\n- [ ] y\r\n";
    const lines = splitLines(content);
    const rolled = [lines.indexOf("- [ ] x"), lines.indexOf("- [ ] y")];
    expect(rolled).toStrictEqual([1, 2]);
    const result = applySourceAction({ content, action: "delete", rolledLineIndices: rolled });
    expect(result.content).toBe("a\r\n");
  });

  test("ignores positions beyond the end of the note", () => {
    const result = applySourceAction({
      content: "- [ ] a",
      action: "delete",
      rolledLineIndices: [0, 5],
    });
    expect(result.content).toBe("");
  });

  test("drops headings left with no content", () => {
    const content = "## Work\n- [ ] a\n## Home\n- [x] b";
    const result = applySourceAction({
      content,
      action: "delete",
      rolledLineIndices: [1],
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
      rolledLineIndices: [0],
    });
    expect(result).toStrictEqual({ content: "- [>] a\n- [x] b", changed: true });
  });

  test("marks open children as well as their parent", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] parent\n    - [ ] child",
      rolledLineIndices: [0, 1],
    });
    expect(result.content).toBe("- [>] parent\n    - [>] child");
  });

  test("leaves rolled completed children as they were", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] parent\n    - [x] done child\n    - plain note",
      rolledLineIndices: [0, 1, 2],
    });
    expect(result.content).toBe("- [>] parent\n    - [x] done child\n    - plain note");
  });

  test("marks custom in-progress statuses", () => {
    const result = applySourceAction({
      ...base,
      content: "- [/] half",
      rolledLineIndices: [0],
    });
    expect(result.content).toBe("- [>] half");
  });

  test("does not touch todos that were not rolled", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] rolled\n- [ ]\n- [ ] kept",
      rolledLineIndices: [0],
    });
    expect(result.content).toBe("- [>] rolled\n- [ ]\n- [ ] kept");
  });

  test("does not mark an identical line that was not rolled", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] a\n```\n- [ ] a\n```",
      rolledLineIndices: [0],
    });
    expect(result.content).toBe("- [>] a\n```\n- [ ] a\n```");
  });

  test("works on CRLF files and keeps the line endings", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] a\r\n- [x] b\r\n",
      rolledLineIndices: [0],
    });
    expect(result.content).toBe("- [>] a\r\n- [x] b\r\n");
  });

  test("leaves blockquote children alone when ignoreBlockquotes is on", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] parent\n    > - [ ] habit in callout",
      rolledLineIndices: [0, 1],
      ignoreBlockquotes: true,
    });
    expect(result.content).toBe("- [>] parent\n    > - [ ] habit in callout");
  });

  test("marks blockquote todos when ignoreBlockquotes is off", () => {
    const result = applySourceAction({
      ...base,
      content: "> - [ ] quoted",
      rolledLineIndices: [0],
    });
    expect(result.content).toBe("> - [>] quoted");
  });

  test("supports multi-codepoint markers and $ in the marker", () => {
    expect(
      applySourceAction({ ...base, marker: "➡️", content: "- [ ] a", rolledLineIndices: [0] })
        .content
    ).toBe("- [➡️] a");
    expect(
      applySourceAction({ ...base, marker: "$", content: "- [ ] a", rolledLineIndices: [0] })
        .content
    ).toBe("- [$] a");
  });

  test("reports unchanged when nothing matched", () => {
    const result = applySourceAction({
      ...base,
      content: "- [x] b",
      rolledLineIndices: [0],
    });
    expect(result).toStrictEqual({ content: "- [x] b", changed: false });
  });

  test("does not delete anything or touch headings", () => {
    const result = applySourceAction({
      ...base,
      content: "## Work\n- [ ] a",
      rolledLineIndices: [1],
    });
    expect(result.content).toBe("## Work\n- [>] a");
  });
});
