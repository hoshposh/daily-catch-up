import { describe, expect, test } from "vitest";
import { getSections, splitLines } from "./get-todos";
import { insertSections } from "./insert-sections";
import { applySourceAction } from "./source-action";

// The parts of rollover() that do not need Obsidian, run end to end
function rollover({ yesterday, today = "", templateHeading = "none", action = "delete" }) {
  const sections = getSections({
    lines: splitLines(yesterday),
    withChildren: true,
    doneStatusMarkers: "xX-",
  });
  const inserted = insertSections({
    content: today,
    sections,
    templateHeading,
    leadingNewLine: true,
  });
  const source = applySourceAction({
    content: yesterday,
    action,
    rolledLineIndices: sections.flatMap((s) => s.incompleteLineIndices),
    doneStatusMarkers: "xX-",
  });
  return { today: inserted.content, yesterday: source.content };
}

describe("rollover without a template heading", () => {
  const yesterday = [
    "# Work",
    "",
    "- [ ] Ship release",
    "  - [x] Write changelog",
    "  - [ ] Tag version",
    "  - remember to bump manifest",
    "- [x] Fix flaky test",
    "- [ ]",
    "",
    "## Home",
    "",
    "- [ ] Laundry",
  ].join("\n");

  test("delete: today's note gets the headings, yesterday's loses the one that is now empty", () => {
    const result = rollover({ yesterday, action: "delete" });
    expect(result.today).toBe(
      [
        "# Work",
        "",
        "- [ ] Ship release",
        "  - [x] Write changelog",
        "  - [ ] Tag version",
        "  - remember to bump manifest",
        "- [ ]",
        "",
        "## Home",
        "",
        "- [ ] Laundry",
        "",
      ].join("\n")
    );
    // Home had only the rolled todo, so it is gone from yesterday's note
    expect(result.yesterday).toBe(["# Work", "", "- [x] Fix flaky test", ""].join("\n"));
  });

  test("mark: yesterday keeps everything, with the rolled todos marked", () => {
    const result = rollover({ yesterday, action: "mark" });
    expect(result.yesterday).toBe(
      yesterday
        .replace("- [ ] Ship release", "- [>] Ship release")
        .replace("  - [ ] Tag version", "  - [>] Tag version")
        .replace("- [ ]\n", "- [>]\n")
        .replace("- [ ] Laundry", "- [>] Laundry")
    );
  });
});
