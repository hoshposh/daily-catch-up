import { describe, expect, test } from "vitest";
import { getSections, splitLines } from "./get-todos";
import { insertSections } from "./insert-sections";
import { dedupeAgainstExisting } from "./insert-todos";
import { appendToBacklog } from "./backlog";
import { applyPlan, planDecisions, planInsert } from "./rollover-plan";
import { applySourceAction, markCancelled } from "./source-action";

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

// The reviewed flow, through the same plan steps index.js calls: plan the
// decisions, apply them, plan the insert into today's note; backlog; then
// cancel marks before the source action, on the original positions
function reviewedRollover({
  yesterday,
  today = "",
  action,
  decisions,
  track,
  skipCompleted = true,
  removeEmpty = false,
  skipExisting = false,
}) {
  const lines = splitLines(yesterday);
  const sections = getSections({
    lines,
    withChildren: true,
    doneStatusMarkers: "xX-",
    skipCompletedChildren: skipCompleted,
  });
  const plan = planDecisions({
    sections,
    lines,
    settings: {
      removeEmptyTodos: removeEmpty,
      rolloverChildren: true,
      trackRolloverCount: track,
      staleAfterRollovers: 5,
      staleBehavior: "keep",
      backlogEnabled: true,
    },
  });
  // without decisions, the defaults apply as when no review is shown
  const decided = applyPlan({ plan, decisions: decisions ?? plan.decisions });
  const toInsert = planInsert({
    sections: decided.rolledSections,
    todayContent: today,
    settings: {
      skipExistingTodos: skipExisting,
      rolloverChildren: true,
      trackRolloverCount: track,
      doneStatusMarkers: "xX-",
    },
  });
  const inserted = insertSections({
    content: today,
    sections: toInsert.sections,
    templateHeading: "none",
    leadingNewLine: true,
  });
  const backlog =
    decided.backlogItems.length > 0
      ? appendToBacklog({
          content: "",
          heading: "",
          items: decided.backlogItems,
          sourceNoteName: "2026-11-06",
          leadingNewLine: true,
        })
      : "";
  const cancelled = markCancelled({
    content: yesterday,
    lineIndices: decided.cancelledLineIndices,
    marker: "-",
    doneStatusMarkers: "xX-",
  });
  const source = applySourceAction({
    content: cancelled.content,
    action,
    rolledLineIndices: decided.movedLineIndices,
    deletedLineIndices: decided.deleteLineIndices,
    skippedLineIndices: decided.skippedLineIndices,
    marker: ">",
    doneStatusMarkers: "xX-",
    retainLineIndices: toInsert.retainedLineIndices,
  });
  return {
    today: inserted.content,
    yesterday: source.content,
    backlog,
    items: plan.items,
  };
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

describe("a recurring task with notes and a completed sub-task under it", () => {
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
    "Blah blah ",
    "",
    "## Tasks",
    "",
    "### Project",
    "",
    "- [ ] Ship release",
    "  - [ ] Tag version",
    "- [ ] Standup",
    "\t- Meeting delayed 10 minutes",
    "\t  - [x] ask Bob about the deploy",
    "- [ ] Review inbox",
    "  - [ ] triage",
    "",
    "### Home",
    "",
    "- [ ] Laundry",
    "- [x] Water plants",
    "",
  ].join("\n");

  test("Standup is not rolled over again, and its notes stay in yesterday's note", () => {
    const result = rollover({
      yesterday,
      today: template,
      templateHeading: "## Tasks",
      skipExisting: true,
      action: "mark",
      moveNested: true,
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
    expect(result.yesterday).toBe(
      [
        "# Work",
        "",
        "Blah blah ",
        "",
        "## Tasks",
        "",
        "### Project",
        "",
        "- [>] Ship release",
        "- [>] Standup",
        "\t- Meeting delayed 10 minutes",
        "\t  - [x] ask Bob about the deploy",
        "- [>] Review inbox",
        "  - [>] triage",
        "",
        "### Home",
        "",
        "- [>] Laundry",
        "- [x] Water plants",
        "",
      ].join("\n")
    );
  });
});

describe("rollover between notes with CRLF line endings", () => {
  const crlf = (lines) => lines.join("\r\n");

  test("both notes keep CRLF endings", () => {
    const yesterday = crlf(["## Tasks", "", "- [ ] Ship release", "  - note", "- [x] Done", ""]);
    const today = crlf(["## Tasks", "", "- [ ] Standup", "", "## Home", ""]);
    const result = rollover({ yesterday, today, templateHeading: "## Tasks", action: "delete" });
    expect(result.today).toBe(
      crlf(["## Tasks", "", "- [ ] Standup", "- [ ] Ship release", "  - note", "", "## Home", ""])
    );
    expect(result.yesterday).toBe(crlf(["## Tasks", "", "- [x] Done", ""]));
  });
});

describe("reviewed rollover with decisions", () => {
  const yesterday = [
    "# Work",
    "",
    "- [ ] Ship [rolled:: 2]",
    "  - [x] Changelog",
    "  - [ ] Tag",
    "- [ ] Old idea",
    "- [ ] Call Sam",
    "",
    "## Home",
    "",
    "- [ ] Laundry",
  ].join("\n");
  const decisions = {
    "0:0": "roll",
    "0:2": "backlog",
    "0:3": "cancel",
    "1:0": "leave",
  };

  test("delete: rolled and backlogged lines go, cancelled is marked, left stays", () => {
    const r = reviewedRollover({
      yesterday,
      action: "delete",
      decisions,
      track: true,
    });
    expect(r.yesterday).toBe(
      ["# Work", "", "- [-] Call Sam", "", "## Home", "", "- [ ] Laundry"].join(
        "\n",
      ),
    );
    expect(r.today).toContain("- [ ] Ship [rolled:: 3]");
    expect(r.today).not.toContain("Old idea");
    expect(r.today).not.toContain("Laundry");
    expect(r.backlog).toBe("- [ ] Old idea [from:: [[2026-11-06]]]\n");
  });

  test("none: only the cancelled line changes in the previous note", () => {
    const r = reviewedRollover({
      yesterday,
      action: "none",
      decisions,
      track: true,
    });
    expect(r.yesterday).toBe(
      yesterday.replace("- [ ] Call Sam", "- [-] Call Sam"),
    );
  });

  test("all roll and no tracking matches the existing flow exactly", () => {
    const all = { "0:0": "roll", "0:2": "roll", "0:3": "roll", "1:0": "roll" };
    // the existing helper does not pass skippedLineIndices, so compare without skipping
    const r = reviewedRollover({
      yesterday,
      action: "delete",
      decisions: all,
      track: false,
      skipCompleted: false,
    });
    const old = rollover({ yesterday, action: "delete" });
    expect(r.today).toBe(old.today);
    expect(r.yesterday).toBe(old.yesterday);
  });
});

describe("reviewed rollover with empty todos dropped", () => {
  test("a dropped empty child does not split its item, and Leave keeps it all", () => {
    const yesterday = ["- [ ] L", "  - [ ]", "  - [ ] c", "  - [x] done"].join(
      "\n",
    );
    const r = reviewedRollover({
      yesterday,
      action: "delete",
      decisions: { "0:0": "leave" },
      track: false,
      removeEmpty: true,
    });
    expect(r.items.map((i) => i.lineIndices)).toEqual([[0, 2]]);
    expect(r.yesterday).toBe(yesterday);
    expect(r.today).toBe("");
  });

  test("a top-level empty todo and its completed child are deleted, not given to the todo above", () => {
    const yesterday = ["- [ ] A", "- [ ]", "  - [x] done", "- [ ] B"].join(
      "\n",
    );
    const r = reviewedRollover({
      yesterday,
      action: "delete",
      decisions: { "0:0": "leave", "0:1": "roll" },
      track: false,
      removeEmpty: true,
    });
    expect(r.items.map((i) => i.lineIndices)).toEqual([[0], [3]]);
    expect(r.yesterday).toBe("- [ ] A");
    expect(r.today).toBe("- [ ] B\n");
  });

  test("only the head of an item with a dropped empty child gets the counter", () => {
    const r = reviewedRollover({
      yesterday: ["- [ ] R", "  - [ ]", "  - [ ] c"].join("\n"),
      action: "delete",
      track: true,
      removeEmpty: true,
    });
    expect(r.today).toBe("- [ ] R [rolled:: 1]\n  - [ ] c\n");
    expect(r.yesterday).toBe("");
  });
});
