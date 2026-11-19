import { beforeEach, describe, expect, test, vi } from "vitest";
import { getSections } from "./get-todos";
import {
  insertSources,
  applySources,
  planSources,
  backlogFailedNotice,
  INBOX_GUARD_NOTICE,
  inboxPathConflicts,
  inboxSource,
  inboxSourceAction,
  rolloverNotice,
  sourceLabel,
  sourceUnchangedNotice,
  sourceWriteFailedNotice,
  templaterNotice,
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

  test("throws when two sources' ids collide", () => {
    // "1" + "0:0" and "" + "10:0" are both "10:0": a key must end in a
    // non-digit separator
    const lines = Array.from({ length: 11 }, (_, i) => [
      `## H${i}`,
      `- [ ] t${i}`,
    ]).flat();
    const sources = [
      source("", "2026-11-16", lines),
      source("1", "Other", ["- [ ] x"]),
    ];
    expect(() => planSources({ sources, settings: PLAN_SETTINGS })).toThrow(
      'planSources: duplicate item id "10:0"'
    );
  });
});

describe("placement and uncounted sources", () => {
  const MOVE_SHOP = {
    id: "r",
    enabled: true,
    match: "tag",
    value: "@shop",
    effect: "move",
    target: "Shopping",
  };

  function inboxSetup(settings, inboxLines) {
    const sources = [
      source("", "2026-11-16", ["- [ ] Ship", "- [ ] Call"]),
      {
        ...source("inbox/", "Inbox", inboxLines),
        placement: "## Inbox",
        countRollover: false,
      },
    ];
    const planned = planSources({
      sources,
      settings: { ...PLAN_SETTINGS, ...settings },
    });
    return { sources, ...planned };
  }

  test("placement moves inbox items unless a rule already moves them", () => {
    const { plans } = inboxSetup({ rules: [MOVE_SHOP] }, [
      "- [ ] Buy milk @shop",
      "- [ ] Call",
    ]);
    expect(plans[1].items.map((i) => i.rule.moveTo)).toEqual([
      "## Shopping",
      "## Inbox",
    ]);
    expect(plans[0].items.map((i) => i.rule.moveTo)).toEqual([null, null]);
  });

  test("inbox items are not counted", () => {
    const { sources, plans, decisions } = inboxSetup(
      { trackRolloverCount: true },
      ["- [ ] Buy milk", "- [ ] Old [rolled:: 4]"]
    );
    const applied = applySources({ plans, sources, decisions });
    expect(applied.perSource[0].noStaleLineIndices).toEqual([]);
    expect(applied.perSource[1].noStaleLineIndices).toEqual([0, 1]);
    const { content } = insertSources({
      content: "",
      entries: entriesOf(sources, applied),
      settings: { ...insertSettings(false), trackRolloverCount: true },
    });
    expect(content).toContain("- [ ] Ship [rolled:: 1]");
    expect(content).toContain("- [ ] Call [rolled:: 1]");
    expect(content).toContain("- [ ] Buy milk\n");
    expect(content).toContain("- [ ] Old [rolled:: 4]");
    expect(content).not.toContain("Buy milk [rolled");
  });

  test("insertSources reports a missing template heading", () => {
    const entry = {
      sections: [
        {
          headingPath: [],
          incompleteTodos: ["- [ ] x"],
          incompleteLineIndices: [0],
        },
      ],
      lines: ["- [ ] x"],
    };
    const result = insertSources({
      content: "# Day\n",
      entries: [entry],
      settings: { ...insertSettings(false), templateHeading: "## Missing" },
    });
    expect(result.templateHeadingNotFound).toBe(true);
    expect(result.content.trimEnd().endsWith("- [ ] x")).toBe(true);
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

  test("writeSource keeps headings for a source that asks", () => {
    const lines = ["## Captured", "- [ ] a", "- [ ] b"];
    const { source: src, decided } = decide(lines, "delete");
    const run = (source) =>
      writeSource({
        content: lines.join("\n"),
        source,
        decided,
        settings: SETTINGS,
      }).content;
    expect(run({ ...src, keepHeadings: true })).toBe("## Captured");
    expect(run(src)).toBe("");
    expect(applySourceAction.mock.calls[0][0].keepHeadings).toBe(true);
    expect(applySourceAction.mock.calls[1][0].keepHeadings).toBe(false);
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
      keepHeadings: false,
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

  test("empty todos are summed over deleting sources, left todos are per source", () => {
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
        "- 3 empty todos removed. ",
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

describe("rolloverNotice with an inbox", () => {
  const PREVIOUS = {
    kind: "previous",
    name: "2026-11-16",
    sourceAction: "delete",
    removedEmptyTodos: 0,
    leftCount: 0,
    rolledCount: 3,
  };
  const INBOX = {
    kind: "inbox",
    name: "Inbox",
    sourceAction: "delete",
    removedEmptyTodos: 0,
    leftCount: 0,
    rolledCount: 2,
  };
  const NOTICE = {
    templateHeadingNotFound: false,
    templateHeading: "none",
    todosAdded: 5,
    todosAlreadyPresent: 0,
    backlogCount: 0,
    backlogPath: "",
    cancelledCount: 0,
    sources: [PREVIOUS, INBOX],
  };

  test("the rolled line names the inbox", () => {
    expect(rolloverNotice(NOTICE)).toBe(
      "- 5 todos rolled over (2 from Inbox). "
    );
    expect(
      rolloverNotice({
        ...NOTICE,
        sources: [PREVIOUS, { ...INBOX, rolledCount: 0 }],
      })
    ).toBe("- 5 todos rolled over. ");
  });

  test("an inbox-only rollover does not repeat the count", () => {
    expect(
      rolloverNotice({
        ...NOTICE,
        todosAdded: 2,
        sources: [{ ...PREVIOUS, rolledCount: 0 }, INBOX],
      })
    ).toBe("- 2 todos rolled over. ");
    // no previous note at all
    expect(
      rolloverNotice({ ...NOTICE, todosAdded: 2, sources: [INBOX] })
    ).toBe("- 2 todos rolled over. ");
  });

  test("left lines per source", () => {
    const sources = [
      { ...PREVIOUS, leftCount: 1 },
      { ...INBOX, leftCount: 1 },
    ];
    expect(rolloverNotice({ ...NOTICE, todosAdded: 0, sources })).toBe(
      "- 1 left in 2026-11-16.\n- 1 left in Inbox."
    );
  });

  test("empty todos are summed over deleting sources", () => {
    const empty = (previous, inbox) => [
      { ...PREVIOUS, removedEmptyTodos: 1, ...previous },
      { ...INBOX, removedEmptyTodos: 2, ...inbox },
    ];
    const notice = (sources) =>
      rolloverNotice({ ...NOTICE, todosAdded: 0, sources });
    expect(notice(empty({}, {}))).toBe("- 3 empty todos removed. ");
    expect(notice(empty({}, { sourceAction: "mark" }))).toBe(
      "- 1 empty todo removed. "
    );
    expect(
      notice(empty({ sourceAction: "mark" }, { sourceAction: "mark" }))
    ).toBe("");
  });
});

describe("source notices", () => {
  const PREVIOUS = { kind: "previous", name: "2026-11-16" };
  const INBOX = { kind: "inbox", name: "Inbox" };
  const TEMPLATER_TAIL =
    "unchanged: today's note was modified by another plugin (likely Templater) after the todos were added, and they may be missing. Run 'Roll over todos now' to try again.";

  test("labels", () => {
    expect(sourceLabel(PREVIOUS)).toBe("the previous day's note");
    expect(sourceLabel(INBOX)).toBe("the inbox note 'Inbox'");
  });

  test("unchanged notices", () => {
    expect(sourceUnchangedNotice(PREVIOUS)).toBe(
      "Rollover left the previous day's note unchanged: it was edited while the rollover was running."
    );
    expect(sourceUnchangedNotice(INBOX)).toBe(
      "Rollover left the inbox note 'Inbox' unchanged: it was edited while the rollover was running. Its todos were still added to today's note; remove them from the inbox yourself."
    );
  });

  test("Templater notice names every source", () => {
    expect(templaterNotice([PREVIOUS])).toBe(
      `Rollover left the previous day's note ${TEMPLATER_TAIL}`
    );
    expect(templaterNotice([PREVIOUS, INBOX])).toBe(
      `Rollover left the previous day's note and the inbox note 'Inbox' ${TEMPLATER_TAIL}`
    );
    expect(
      templaterNotice([INBOX]).startsWith(
        "Rollover left the inbox note 'Inbox' unchanged: "
      )
    ).toBe(true);
  });

  test("backlog failure notice names every source", () => {
    const base = {
      backlogPath: "Backlog.md",
      error: new Error("disk full"),
      todosAdded: 2,
      sources: [PREVIOUS],
    };
    expect(backlogFailedNotice(base)).toBe(
      "Rollover couldn't write the backlog note 'Backlog.md' (disk full), so the previous day's note was left unchanged. 2 todos were rolled over to today's note."
    );
    expect(backlogFailedNotice({ ...base, todosAdded: 1 })).toMatch(
      /1 todo was rolled over to today's note\.$/
    );
    expect(backlogFailedNotice({ ...base, todosAdded: 0 })).toMatch(
      /was left unchanged\.$/
    );
    expect(backlogFailedNotice({ ...base, sources: [PREVIOUS, INBOX] })).toBe(
      "Rollover couldn't write the backlog note 'Backlog.md' (disk full), so the previous day's note and the inbox note 'Inbox' were left unchanged. 2 todos were rolled over to today's note."
    );
    expect(backlogFailedNotice({ ...base, error: "nope" })).toContain("(nope)");
  });

  test("source write failure notice", () => {
    expect(sourceWriteFailedNotice(INBOX, new Error("locked"))).toBe(
      "Rollover couldn't write the inbox note 'Inbox' (locked), so it was left unchanged. Its todos were still added to today's note."
    );
    expect(sourceWriteFailedNotice(PREVIOUS, new Error("locked"))).toContain(
      "the previous day's note"
    );
  });
});

describe("the inbox source", () => {
  const FILE = { path: "Inbox.md", basename: "Inbox" };
  const parsed = { content: "- [ ] a\n", lines: ["- [ ] a", ""], sections: [] };
  const build = (settings) => inboxSource({ file: FILE, ...parsed, settings });

  test("the inbox action is mark or delete, never anything else", () => {
    expect(inboxSourceAction({ inboxSourceAction: "mark" })).toBe("mark");
    expect(inboxSourceAction({ inboxSourceAction: "delete" })).toBe("delete");
    // a hand-edited "none" would pull the same todos every day
    expect(inboxSourceAction({ inboxSourceAction: "none" })).toBe("delete");
    expect(inboxSourceAction({})).toBe("delete");
  });

  test("the source object", () => {
    expect(build({ inboxSourceAction: "delete", inboxHeading: "" })).toEqual({
      key: "inbox/",
      kind: "inbox",
      name: "Inbox",
      file: FILE,
      ...parsed,
      sourceAction: "delete",
      keepHeadings: true,
      countRollover: false,
      placement: null,
    });
  });

  test("the inbox heading becomes the placement", () => {
    expect(build({ inboxHeading: "Captured" }).placement).toBe("## Captured");
    expect(build({ inboxHeading: "### Captured" }).placement).toBe(
      "### Captured"
    );
    expect(build({ inboxHeading: "   " }).placement).toBe(null);
    expect(build({}).placement).toBe(null);
    expect(build({ inboxSourceAction: "mark" }).sourceAction).toBe("mark");
  });

  test("the inbox guard", () => {
    const paths = {
      inboxPath: "Inbox.md",
      todayPath: "Daily/2026-11-18.md",
      previousPath: "Daily/2026-11-17.md",
      backlogPath: "Backlog.md",
    };
    expect(inboxPathConflicts(paths)).toBe(false);
    expect(inboxPathConflicts({ ...paths, inboxPath: paths.todayPath })).toBe(
      true
    );
    expect(
      inboxPathConflicts({ ...paths, inboxPath: paths.previousPath })
    ).toBe(true);
    expect(inboxPathConflicts({ ...paths, inboxPath: "Backlog.md" })).toBe(
      true
    );
    // no previous note, no backlog note: only today's note is compared
    expect(
      inboxPathConflicts({
        ...paths,
        previousPath: undefined,
        backlogPath: null,
      })
    ).toBe(false);
    expect(
      inboxPathConflicts({
        inboxPath: paths.todayPath,
        todayPath: paths.todayPath,
      })
    ).toBe(true);
    expect(INBOX_GUARD_NOTICE).toBe(
      "The inbox note can't be today's note, the previous daily note or the backlog note. Change it in settings."
    );
  });
});
