import { describe, expect, test, vi } from "vitest";
import { splitLines } from "./get-todos";
import {
  applySourceAction,
  effectiveDoneStatusMarkers,
  isCancelAvailable,
  markCancelled,
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

  test("keeps a heading that was already empty", () => {
    const content = "## Notes\n\n## Tasks\n- [ ] a\n- [x] b";
    const result = applySourceAction({
      content,
      action: "delete",
      rolledLineIndices: [3],
    });
    expect(result.content).toBe("## Notes\n\n## Tasks\n- [x] b");
  });

  test("does not treat # lines in a code block as headings", () => {
    const content = "## Script\n```\n# install\n```\n- [ ] a";
    const result = applySourceAction({
      content,
      action: "delete",
      rolledLineIndices: [4],
    });
    expect(result.content).toBe("## Script\n```\n# install\n```");
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

describe("applySourceAction: mark with moveNested", () => {
  const base = { action: "mark", marker: ">", doneStatusMarkers: "xX-", moveNested: true };

  test("keeps the marked todo as a stub and removes everything rolled under it", () => {
    const content = [
      "- [ ] Ship release",
      "  - [x] Write changelog",
      "  - [ ] Tag version",
      "  - remember to bump manifest",
      "- [x] Fix flaky test",
      "- [ ]",
    ].join("\n");
    const result = applySourceAction({
      ...base,
      content,
      rolledLineIndices: [0, 1, 2, 3, 5],
    });
    expect(result).toStrictEqual({
      content: ["- [>] Ship release", "- [x] Fix flaky test", "- [>]"].join("\n"),
      changed: true,
    });
  });

  test("removes deeper levels too", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] a\n  - b\n    - c\n- [ ] d\n  - e",
      rolledLineIndices: [0, 1, 2, 3, 4],
    });
    expect(result.content).toBe("- [>] a\n- [>] d");
  });

  test("leaves nested lines that were not rolled, such as skipped completed children", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] parent\n  - [x] done child\n  - plain note",
      rolledLineIndices: [0, 2],
    });
    expect(result.content).toBe("- [>] parent\n  - [x] done child");
  });

  test("keeps the nested lines listed in retainLineIndices", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] Standup\n  - [x] ask Bob\n  - [ ] prepare",
      rolledLineIndices: [0, 1, 2],
      retainLineIndices: [1],
    });
    expect(result.content).toBe("- [>] Standup\n  - [x] ask Bob");
  });

  test("a retained open child is still marked", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] Standup\n  - [ ] prepare",
      rolledLineIndices: [0, 1],
      retainLineIndices: [1],
    });
    expect(result.content).toBe("- [>] Standup\n  - [>] prepare");
  });

  test("does not remove an unrelated line that follows", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] a\n  - b\n\n  - not rolled\n- [ ] c",
      rolledLineIndices: [0, 1, 4],
    });
    expect(result.content).toBe("- [>] a\n\n  - not rolled\n- [>] c");
  });

  test("works on CRLF files", () => {
    const result = applySourceAction({
      ...base,
      content: "- [ ] a\r\n  - b\r\n- [x] c\r\n",
      rolledLineIndices: [0, 1],
    });
    expect(result.content).toBe("- [>] a\r\n- [x] c\r\n");
  });

  test("without moveNested the nested lines stay", () => {
    const result = applySourceAction({
      ...base,
      moveNested: false,
      content: "- [ ] a\n  - b",
      rolledLineIndices: [0, 1],
    });
    expect(result.content).toBe("- [>] a\n  - b");
  });
});


describe("cancel marking", () => {
  test("markCancelled marks only open todos at the given lines", () => {
    const content = "- [ ] a\n  - [x] b\n  - [ ] c\n- [ ] d";
    expect(markCancelled({ content, lineIndices: [0, 1, 2], marker: "-" })).toEqual({
      content: "- [-] a\n  - [x] b\n  - [-] c\n- [ ] d",
      changed: true,
    });
  });

  test("markCancelled keeps CRLF", () => {
    expect(
      markCancelled({
        content: "- [ ] a\r\n- [ ] b",
        lineIndices: [0],
        marker: "-",
      }).content,
    ).toBe("- [-] a\r\n- [ ] b");
  });

  test("markCancelled reports no change and never changes the line count", () => {
    const content = "- [x] a\nplain\n- [ ] b";
    expect(markCancelled({ content, lineIndices: [0, 1, 9], marker: "-" })).toEqual({
      content,
      changed: false,
    });
    const result = markCancelled({ content, lineIndices: [2], marker: "~" });
    expect(result.content.split("\n")).toHaveLength(3);
  });

  test("normalizeMarker takes a fallback", () => {
    expect(normalizeMarker("", "-")).toBe("-");
    expect(normalizeMarker("ab", "-")).toBe("-");
    expect(normalizeMarker("~", "-")).toBe("~");
  });

  test("Cancel is available only when its marker is a done marker", () => {
    expect(isCancelAvailable({ doneStatusMarkers: "xX-" })).toBe(true);
    expect(isCancelAvailable({ doneStatusMarkers: "" })).toBe(true); // parser default
    expect(isCancelAvailable({ doneStatusMarkers: "xX" })).toBe(false);
    expect(isCancelAvailable({ doneStatusMarkers: "xX", cancelMarker: "~" })).toBe(false);
    expect(isCancelAvailable({ doneStatusMarkers: "xX~", cancelMarker: "~" })).toBe(true);
    // while marking, the rollover marker counts as done, so it can be the cancel marker too
    expect(
      isCancelAvailable({
        doneStatusMarkers: "xX",
        onRolloverSourceAction: "mark",
        rolloverSourceMarker: ">",
        cancelMarker: ">",
      }),
    ).toBe(true);
  });

  test("effectiveDoneStatusMarkers does not add the cancel marker", () => {
    expect(
      effectiveDoneStatusMarkers({ doneStatusMarkers: "xX", cancelMarker: "~" }),
    ).toBe("xX");
  });
});
