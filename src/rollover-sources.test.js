import { beforeEach, describe, expect, test, vi } from "vitest";
import { getSections } from "./get-todos";
import {
  insertSources,
  applySources,
  planSources,
  rolloverNotice,
  writeSource,
} from "./rollover-sources";
import { applySourceAction, markCancelled } from "./source-action";

// the real functions, wrapped so a test can see the arguments writeSource()
// passes them
vi.mock("./source-action", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    applySourceAction: vi.fn(actual.applySourceAction),
    markCancelled: vi.fn(actual.markCancelled),
  };
});

const PLAN_SETTINGS = {
  removeEmptyTodos: false,
  rolloverChildren: true,
  trackRolloverCount: false,
  staleAfterRollovers: 5,
  staleBehavior: "keep",
  backlogEnabled: true,
  cancelEnabled: true,
  rules: [],
};

function source(key, name, lines) {
  return {
    key,
    kind: key ? "inbox" : "previous",
    name,
    lines,
    sections: getSections({
      lines,
      withChildren: true,
      doneStatusMarkers: "xX-",
    }),
    sourceAction: "delete",
  };
}

function setup() {
  const sources = [
    source("", "2026-11-16", ["## Work", "- [ ] Ship", "- [ ] Call"]),
    source("inbox/", "Inbox", ["- [ ] Call", "- [ ] Buy milk"]),
  ];
  const { plans, items, decisions } = planSources({
    sources,
    settings: PLAN_SETTINGS,
  });
  return { sources, plans, items, decisions };
}

function insertSettings(skipExistingTodos) {
  return {
    skipExistingTodos,
    rolloverChildren: true,
    trackRolloverCount: false,
    doneStatusMarkers: "xX-",
    templateHeading: "none",
    leadingNewLine: true,
  };
}

function entriesOf(sources, applied, only) {
  return applied.perSource
    .map((p, i) => ({
      sections: p.rolledSections,
      lines: sources[i].lines,
      noStaleLineIndices: p.noStaleLineIndices,
    }))
    .slice(0, only);
}

function rolloverInto({ skipExistingTodos, decisions: override }) {
  const { sources, plans, decisions } = setup();
  const applied = applySources({
    plans,
    sources,
    decisions: { ...decisions, ...override },
  });
  return insertSources({
    content: "",
    entries: entriesOf(sources, applied),
    settings: insertSettings(skipExistingTodos),
  });
}

describe("planSources", () => {
  test("ids are unique across sources and decisions cover every item", () => {
    const { items, decisions } = setup();
    const ids = ["0:0", "0:1", "inbox/0:0", "inbox/0:1"];
    expect(items.map((i) => i.id)).toEqual(ids);
    expect(Object.keys(decisions)).toEqual(ids);
  });
});

describe("writeSource", () => {
  const SETTINGS = {
    onRolloverSourceAction: "delete",
    rolloverSourceMarker: ">",
    cancelMarker: "-",
    doneStatusMarkers: "xX-",
    ignoreBlockquotes: false,
    moveNestedItemsOnMark: false,
    rolloverChildren: true,
  };

  // one source, planned and decided: `override` changes default outcomes
  function decide(lines, sourceAction, override = {}) {
    const src = { ...source("", "2026-11-16", lines), sourceAction };
    const { plans, decisions } = planSources({
      sources: [src],
      settings: PLAN_SETTINGS,
    });
    const applied = applySources({
      plans,
      sources: [src],
      decisions: { ...decisions, ...override },
    });
    return { source: src, decided: applied.perSource[0] };
  }

  function write(lines, sourceAction, override, settings = {}) {
    return writeSource({
      content: lines.join("\n"),
      ...decide(lines, sourceAction, override),
      settings: {
        ...SETTINGS,
        onRolloverSourceAction: sourceAction,
        ...settings,
      },
    });
  }

  beforeEach(() => {
    applySourceAction.mockClear();
    markCancelled.mockClear();
  });

  test("delete removes moved items and the headings they emptied", () => {
    const lines = [
      "## Work",
      "- [ ] Ship",
      "- [ ] Call",
      "## Home",
      "- [ ] Rest",
    ];
    const result = write(lines, "delete", { "0:1": "leave" });
    expect(result).toEqual({ content: "## Work\n- [ ] Call", changed: true });
  });

  test("mark, with and without moving nested items", () => {
    const lines = ["- [ ] Ship", "  - [ ] Tag", "- [ ] Call"];
    // ids are {section}:{first line of the item in the section}
    const override = { "0:2": "leave" };
    expect(write(lines, "mark", override).content).toBe(
      "- [>] Ship\n  - [>] Tag\n- [ ] Call"
    );
    const moved = write(lines, "mark", override, {
      moveNestedItemsOnMark: true,
    });
    expect(moved).toEqual({ content: "- [>] Ship\n- [ ] Call", changed: true });
    // nested items only moved when children were rolled over
    const kept = write(lines, "mark", override, {
      moveNestedItemsOnMark: true,
      rolloverChildren: false,
    });
    expect(kept.content).toBe("- [>] Ship\n  - [>] Tag\n- [ ] Call");
  });

  test("with action none only the cancel marks are written", () => {
    const lines = ["- [ ] Ship", "- [ ] Call"];
    expect(write(lines, "none", { "0:0": "cancel" })).toEqual({
      content: "- [-] Ship\n- [ ] Call",
      changed: true,
    });
    expect(applySourceAction).not.toHaveBeenCalled();
    expect(write(lines, "none")).toEqual({
      content: lines.join("\n"),
      changed: false,
    });
  });

  test("cancel marks come first, then the action on the other items", () => {
    const lines = ["- [ ] Ship", "- [ ] Call", "- [ ] Rest"];
    const result = write(lines, "delete", { "0:0": "cancel", "0:2": "leave" });
    expect(result.content).toBe("- [-] Ship\n- [ ] Rest");
  });

  test("passes the settings as index.js always has", () => {
    const lines = ["> - [ ] Quoted", "- [ ] Ship", "  - [ ] Tag", "- [ ] Call"];
    const { source: src, decided } = decide(lines, "mark", {
      "0:3": "cancel",
    });
    expect(decided.cancelledLineIndices).toEqual([3]);
    writeSource({
      content: lines.join("\n"),
      source: src,
      decided,
      retainedLineIndices: [2],
      settings: {
        onRolloverSourceAction: "mark",
        // blank markers fall back to "-" for cancel and ">" for mark
        rolloverSourceMarker: "",
        cancelMarker: "",
        doneStatusMarkers: "xX",
        ignoreBlockquotes: true,
        moveNestedItemsOnMark: true,
        rolloverChildren: true,
      },
    });
    expect(markCancelled).toHaveBeenCalledWith({
      content: lines.join("\n"),
      lineIndices: decided.cancelledLineIndices,
      marker: "-",
      // the effective markers: mark's own marker counts as done
      doneStatusMarkers: "xX>",
      ignoreBlockquotes: true,
    });
    expect(applySourceAction).toHaveBeenCalledWith({
      content: markCancelled.mock.results[0].value.content,
      action: "mark",
      rolledLineIndices: decided.movedLineIndices,
      deletedLineIndices: decided.deleteLineIndices,
      skippedLineIndices: decided.skippedLineIndices,
      marker: ">",
      // the raw setting
      doneStatusMarkers: "xX",
      ignoreBlockquotes: true,
      moveNested: true,
      retainLineIndices: [2],
    });
  });
});

describe("applySources", () => {
  test("backlog items carry their source's name, and counts add up", () => {
    const { sources, plans, decisions } = setup();
    const { backlogItems, outcomeCounts } = applySources({
      plans,
      sources,
      decisions: {
        ...decisions,
        "0:1": "backlog",
        "inbox/0:1": "backlog",
        "inbox/0:0": "leave",
      },
    });
    expect(backlogItems.map((i) => i.sourceName)).toEqual([
      "2026-11-16",
      "Inbox",
    ]);
    expect(outcomeCounts).toEqual({ roll: 1, backlog: 2, cancel: 0, leave: 1 });
  });
});

describe("insertSources", () => {
  test("a later source is deduped against what an earlier one inserted", () => {
    const { content, perSource } = rolloverInto({ skipExistingTodos: true });
    const lines = content.split("\n");
    expect(lines.filter((l) => l === "- [ ] Call")).toHaveLength(1);
    expect(lines.filter((l) => l === "- [ ] Buy milk")).toHaveLength(1);
    expect(perSource[1].todosAlreadyPresent).toBe(1);
    expect(perSource[1].retainedLineIndices).toEqual([0]);
  });

  test("without skip existing both copies are inserted", () => {
    const { content } = rolloverInto({ skipExistingTodos: false });
    const lines = content.split("\n");
    expect(lines.filter((l) => l === "- [ ] Call")).toHaveLength(2);
  });

  test("an entry whose todos are all deduped leaves the note untouched", () => {
    const { sources, plans, decisions } = setup();
    const applied = applySources({ plans, sources, decisions });
    // mostly CRLF with one bare LF: insertSections() would make them all CRLF
    const today = "- [ ] Call\r\n- [ ] Buy milk\r\n- [ ] Ship\r\nnote\n";
    const result = insertSources({
      content: today,
      entries: entriesOf(sources, applied),
      settings: {
        ...insertSettings(true),
        templateHeading: "## Missing",
      },
    });
    expect(result.content).toBe(today);
    expect(result.templateHeadingNotFound).toBe(false);
    expect(result.perSource[1].todosAlreadyPresent).toBe(2);
    expect(result.perSource[1].insertedTodos).toEqual([]);
  });

  test("a source with nothing to insert is skipped", () => {
    const decisions = { "inbox/0:0": "leave", "inbox/0:1": "leave" };
    const result = rolloverInto({ skipExistingTodos: true, decisions });
    expect(result.perSource[1]).toEqual({
      todosAlreadyPresent: 0,
      duplicateTodos: [],
      retainedLineIndices: [],
      insertedTodos: [],
    });

    const { sources, plans, decisions: defaults } = setup();
    const applied = applySources({ plans, sources, decisions: defaults });
    const alone = insertSources({
      content: "",
      entries: entriesOf(sources, applied, 1),
      settings: insertSettings(true),
    });
    expect(result.content).toBe(alone.content);
  });
});

describe("rolloverNotice", () => {
  const SOURCE = {
    name: "2026-11-16",
    sourceAction: "delete",
    removedEmptyTodos: 0,
    leftCount: 0,
  };
  const NOTICE = {
    templateHeadingNotFound: false,
    templateHeading: "none",
    todosAdded: 0,
    todosAlreadyPresent: 0,
    backlogCount: 0,
    backlogPath: "",
    cancelledCount: 0,
    sources: [SOURCE],
  };

  test("rolled todos", () => {
    expect(rolloverNotice({ ...NOTICE, todosAdded: 3 })).toBe(
      "- 3 todos rolled over. "
    );
    expect(rolloverNotice({ ...NOTICE, todosAdded: 1 })).toBe(
      "- 1 todo rolled over. "
    );
  });

  test("every line, in order", () => {
    const message = rolloverNotice({
      templateHeadingNotFound: true,
      templateHeading: "## Tasks",
      todosAdded: 2,
      todosAlreadyPresent: 1,
      backlogCount: 1,
      backlogPath: "Backlog.md",
      cancelledCount: 1,
      sources: [{ ...SOURCE, removedEmptyTodos: 2, leftCount: 1 }],
    });
    expect(message).toBe(
      [
        "Rollover couldn't find '## Tasks' in today's daily note. Rolling todos to end of file.",
        "- 2 todos rolled over. ",
        "- 2 empty todos removed. ",
        "- 1 line skipped (already in today's note).",
        "- 1 moved to backlog (Backlog.md).",
        "- 1 cancelled.",
        "- 1 left in 2026-11-16.",
      ].join("\n")
    );
  });

  test("empty todos are only reported when they were deleted", () => {
    const sources = [{ ...SOURCE, sourceAction: "mark", removedEmptyTodos: 2 }];
    expect(rolloverNotice({ ...NOTICE, sources })).toBe("");
  });

  test("singular empty todo and skipped line", () => {
    const message = rolloverNotice({
      ...NOTICE,
      todosAlreadyPresent: 1,
      sources: [{ ...SOURCE, removedEmptyTodos: 1 }],
    });
    expect(message).toBe(
      "- 1 empty todo removed. \n- 1 line skipped (already in today's note)."
    );
  });

  test("each source reports its own empty todos and left todos", () => {
    const message = rolloverNotice({
      ...NOTICE,
      todosAdded: 2,
      sources: [
        { ...SOURCE, removedEmptyTodos: 1, leftCount: 2 },
        {
          name: "Inbox",
          sourceAction: "mark",
          removedEmptyTodos: 3,
          leftCount: 0,
        },
        {
          name: "Ideas",
          sourceAction: "delete",
          removedEmptyTodos: 2,
          leftCount: 1,
        },
      ],
    });
    expect(message).toBe(
      [
        "- 2 todos rolled over. ",
        "- 1 empty todo removed. ",
        "- 2 empty todos removed. ",
        "- 2 left in 2026-11-16.",
        "- 1 left in Ideas.",
      ].join("\n")
    );
  });

  test("nothing to say", () => {
    expect(rolloverNotice(NOTICE)).toBe("");
    expect(rolloverNotice({ ...NOTICE, sources: [] })).toBe("");
  });
});
