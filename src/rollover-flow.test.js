import { describe, expect, test } from "vitest";
import { getSections, splitLines } from "./get-todos";
import { insertSections } from "./insert-sections";
import { dedupeAgainstExisting } from "./insert-todos";
import { applySourceAction } from "./source-action";

// The parts of rollover() that do not need Obsidian, run end to end
function rollover({
  yesterday,
  today = "",
  templateHeading = "none",
  action = "delete",
  skipExisting = false,
  skipCompleted = false,
  moveNested = false,
}) {
  const sections = getSections({
    lines: splitLines(yesterday),
    withChildren: true,
    doneStatusMarkers: "xX-",
    skipCompletedChildren: skipCompleted,
  });
  const retainLineIndices = [];
  // todos that today's note already has are not inserted, but still count as rolled
  const toInsert = skipExisting
    ? sections
        .map((s) => {
          const deduped = dedupeAgainstExisting(s.incompleteTodos, today, true, "xX-");
          retainLineIndices.push(
            ...deduped.droppedIndices.map((i) => s.incompleteLineIndices[i])
          );
          return { ...s, incompleteTodos: deduped.todos };
        })
        .filter((s) => s.incompleteTodos.length > 0)
    : sections;
  const inserted = insertSections({
    content: today,
    sections: toInsert,
    templateHeading,
    leadingNewLine: true,
  });
  const source = applySourceAction({
    content: yesterday,
    action,
    rolledLineIndices: sections.flatMap((s) => s.incompleteLineIndices),
    doneStatusMarkers: "xX-",
    moveNested,
    retainLineIndices,
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

describe("rollover into a daily template that already has recurring tasks", () => {
  const template = [
    "# Work",
    "",
    "- [ ] Standup",
    "- [ ] Review inbox",
    "  - [ ] triage",
    "",
    "## Home",
    "",
    "- [ ] Laundry",
    "",
  ].join("\n");
  const yesterday = [
    "# Work",
    "",
    "- [ ] Ship release",
    "  - [ ] Tag version",
    "- [ ] Standup",
    "  - [ ] ask Bob about the deploy",
    "- [ ] Review inbox",
    "  - [ ] triage",
    "",
    "## Home",
    "",
    "- [ ] Laundry",
    "- [ ] Water plants",
    "",
  ].join("\n");

  test("skips duplicates, keeps a duplicate parent whose children are new, and keeps todos above sub-headings", () => {
    const result = rollover({ yesterday, today: template, skipExisting: true, action: "mark" });
    expect(result.today).toBe(
      [
        "# Work",
        "",
        "- [ ] Standup",
        "- [ ] Review inbox",
        "  - [ ] triage",
        "- [ ] Ship release",
        "  - [ ] Tag version",
        "- [ ] Standup",
        "  - [ ] ask Bob about the deploy",
        "",
        "## Home",
        "",
        "- [ ] Laundry",
        "- [ ] Water plants",
        "",
      ].join("\n")
    );
    // skipped duplicates count as handled, so every open todo is marked
    expect(result.yesterday).toBe(yesterday.replaceAll("- [ ]", "- [>]"));
  });
});

describe("rollover under a template heading into a template with recurring tasks", () => {
  const template = [
    "# Work",
    "",
    "## Tasks",
    "",
    "### Project",
    "",
    "- [ ] Standup",
    "- [ ] Review inbox",
    "  - [ ] triage",
    "",
    "### Home",
    "",
    "- [ ] Laundry",
    "",
  ].join("\n");
  const yesterday = [
    "# Work",
    "",
    "Blah blah",
    "",
    "## Tasks",
    "",
    "### Project",
    "",
    "- [ ] Ship release",
    "  - [ ] Tag version",
    "- [ ] Standup",
    "  - [x] ask Bob about the deploy",
    "- [ ] Review inbox",
    "  - [ ] triage",
    "",
    "### Home",
    "",
    "- [ ] Laundry",
    "- [x] Water plants",
    "",
  ].join("\n");

  test("a completed child does not make Standup roll over again", () => {
    const result = rollover({
      yesterday,
      today: template,
      templateHeading: "## Tasks",
      skipExisting: true,
      action: "mark",
    });
    expect(result.today).toBe(
      [
        "# Work",
        "",
        "## Tasks",
        "",
        "### Project",
        "",
        "- [ ] Standup",
        "- [ ] Review inbox",
        "  - [ ] triage",
        "- [ ] Ship release",
        "  - [ ] Tag version",
        "",
        "### Home",
        "",
        "- [ ] Laundry",
        "",
      ].join("\n")
    );
    // every open todo is marked; the completed ones are left as they were
    expect(result.yesterday).toBe(yesterday.replaceAll("- [ ]", "- [>]"));
  });
});

describe("mark with nested items moved to today's note", () => {
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

  test("the marked todo stays as one line; completed children move with the hierarchy", () => {
    const result = rollover({ yesterday, action: "mark", moveNested: true });
    expect(result.yesterday).toBe(
      [
        "# Work",
        "",
        "- [>] Ship release",
        "- [x] Fix flaky test",
        "- [>]",
        "",
        "## Home",
        "",
        "- [>] Laundry",
      ].join("\n")
    );
    // today's note gets the whole hierarchy
    expect(result.today).toContain("  - [x] Write changelog");
    expect(result.today).toContain("  - remember to bump manifest");
  });

  test("with skip completed children, completed children stay in yesterday's note", () => {
    const result = rollover({
      yesterday,
      action: "mark",
      moveNested: true,
      skipCompleted: true,
    });
    expect(result.yesterday).toBe(
      [
        "# Work",
        "",
        "- [>] Ship release",
        "  - [x] Write changelog",
        "- [x] Fix flaky test",
        "- [>]",
        "",
        "## Home",
        "",
        "- [>] Laundry",
      ].join("\n")
    );
    expect(result.today).not.toContain("Write changelog");
    expect(result.today).toContain("  - [ ] Tag version");
  });

  test("a duplicate dropped by skip-existing does not move its children", () => {
    const template = "# Work\n\n- [ ] Standup\n";
    const note = "# Work\n\n- [ ] Standup\n  - [x] ask Bob\n- [ ] Ship\n  - plan\n";
    const result = rollover({
      yesterday: note,
      today: template,
      action: "mark",
      moveNested: true,
      skipExisting: true,
    });
    // Standup was already in today's note, so ask Bob stays; Ship's note moved
    expect(result.yesterday).toBe(
      "# Work\n\n- [>] Standup\n  - [x] ask Bob\n- [>] Ship\n"
    );
    expect(result.today).toBe("# Work\n\n- [ ] Standup\n- [ ] Ship\n  - plan\n");
  });
});
