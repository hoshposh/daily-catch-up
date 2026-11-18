import { describe, expect, test } from "vitest";
import { getSections } from "./get-todos";
import { insertSources, applySources, planSources } from "./rollover-sources";

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
