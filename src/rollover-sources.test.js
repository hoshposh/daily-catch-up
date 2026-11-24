import { beforeEach, describe, expect, test, vi } from "vitest";
import { getSections } from "./get-todos";
import {
  insertSources,
  applySources,
  earlierSource,
  earlierSources,
  planSources,
  backlogFailedNotice,
  backlogSource,
  bringBackNotice,
  BACKLOG_GUARD_EARLIER_NOTICE,
  BACKLOG_GUARD_NOTICE,
  INBOX_GUARD_NOTICE,
  backlogPathConflict,
  inboxGuardNotice,
  inboxPathConflicts,
  inboxSource,
  inboxSourceAction,
  rolloverNotice,
  sourceLabel,
  sourceNeedsWrite,
  sourceUnchangedNotice,
  sourceWriteFailedNotice,
  templaterNotice,
  templaterNoticeSources,
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
      todosDoneElsewhere: 0,
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
    expect(rolloverNotice({ ...NOTICE, todosAdded: 2, sources: [INBOX] })).toBe(
      "- 2 todos rolled over. "
    );
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

describe("earlier sources", () => {
  const HABIT = {
    id: "habit",
    enabled: true,
    match: "tag",
    value: "#habit",
    effect: "leave",
  };
  const LATER = {
    id: "later",
    enabled: true,
    match: "tag",
    value: "#later",
    effect: "backlog",
  };
  const SETTINGS = { ...PLAN_SETTINGS, doneStatusMarkers: "xX->" };

  function earlier(path, lines, newerDoneKeys) {
    const basename = path.split("/").pop().replace(/\.md$/, "");
    return earlierSource({
      file: { path, basename },
      content: lines.join("\n"),
      lines,
      sections: getSections({
        lines,
        withChildren: true,
        doneStatusMarkers: "xX->",
      }),
      settings: { onRolloverSourceAction: "mark" },
      newerDoneKeys,
    });
  }

  test("the source object", () => {
    const file = { path: "journal/2026/11/21.md", basename: "21" };
    const lines = ["- [ ] a"];
    const newerDoneKeys = new Set(["b"]);
    expect(
      earlierSource({
        file,
        content: "- [ ] a",
        lines,
        sections: [],
        settings: { onRolloverSourceAction: "delete" },
        newerDoneKeys,
      })
    ).toEqual({
      key: "journal/2026/11/21.md/",
      kind: "earlier",
      name: "21",
      file,
      content: "- [ ] a",
      lines,
      sections: [],
      sourceAction: "delete",
      newerDoneKeys,
    });
  });

  describe("earlierSources", () => {
    const note = (path, lines) => ({
      file: { path, basename: path.split("/").pop().replace(/\.md$/, "") },
      content: lines.join("\n"),
      lines,
      sections: [],
    });
    const build = ({ todayLines = [], previousLines = [], notes }) =>
      earlierSources({
        todayLines,
        previousLines,
        notes,
        settings: { onRolloverSourceAction: "mark" },
        doneStatusMarkers: "xX->",
      });

    test("one earlierSource() per note, in the order given", () => {
      const notes = [
        note("daily/2026-11-19.md", ["- [ ] a"]),
        note("daily/2026-11-18.md", ["- [ ] b"]),
      ];
      const sources = build({ notes });
      expect(
        sources.map((s) => [s.key, s.kind, s.name, s.sourceAction])
      ).toEqual([
        ["daily/2026-11-19.md/", "earlier", "2026-11-19", "mark"],
        ["daily/2026-11-18.md/", "earlier", "2026-11-18", "mark"],
      ]);
      expect(sources[0].lines).toBe(notes[0].lines);
    });

    test("todos done in today's note and the previous note count for every older note", () => {
      const sources = build({
        todayLines: ["- [x] Call Sam"],
        previousLines: ["- [>] Pay rent"],
        notes: [note("d/2.md", []), note("d/1.md", [])],
      });
      for (const source of sources) {
        expect([...source.newerDoneKeys].sort()).toEqual([
          "Call Sam",
          "Pay rent",
        ]);
      }
    });

    test("a todo done in a newer older note counts for the older ones only", () => {
      const sources = build({
        notes: [
          note("d/3.md", ["- [x] Newest"]),
          note("d/2.md", ["- [x] Middle"]),
          note("d/1.md", ["- [x] Oldest"]),
        ],
      });
      expect(sources.map((s) => [...s.newerDoneKeys].sort())).toEqual([
        [],
        ["Newest"],
        ["Middle", "Newest"],
      ]);
    });

    test("open todos and other markers are not done", () => {
      const [source] = build({
        todayLines: ["- [ ] Open", "- [?] Question"],
        notes: [note("d/1.md", [])],
      });
      expect([...source.newerDoneKeys]).toEqual([]);
    });
  });

  test("two older notes with the same name in different folders", () => {
    const sources = [
      earlier("journal/2026/11/21.md", ["- [ ] a"]),
      earlier("journal/2026/10/21.md", ["- [ ] b"]),
    ];
    const { items } = planSources({ sources, settings: SETTINGS });
    expect(items.map((i) => i.id)).toEqual([
      "journal/2026/11/21.md/0:0",
      "journal/2026/10/21.md/0:0",
    ]);
  });

  test("a rule-chosen Leave is hidden only in an earlier note", () => {
    const lines = ["- [ ] Stretch #habit"];
    const sources = [
      source("", "2026-11-16", lines),
      earlier("Daily/2026-11-15.md", lines),
      source("inbox/", "Inbox", lines),
    ];
    const { items, reviewItems, decisions } = planSources({
      sources,
      settings: { ...SETTINGS, rules: [HABIT] },
    });
    expect(items.map((i) => i.hidden)).toEqual([undefined, true, undefined]);
    expect(reviewItems.map((i) => i.id)).toEqual(["0:0", "inbox/0:0"]);
    expect(Object.values(decisions)).toEqual(["leave", "leave", "leave"]);
  });

  test("an item done in a newer note is handled, hidden and rolled, whatever a Backlog rule says", () => {
    const sources = [
      earlier(
        "Daily/2026-11-15.md",
        ["- [ ] Old #later", "- [ ] New #later"],
        new Set(["Old #later"])
      ),
    ];
    const { items, reviewItems, decisions } = planSources({
      sources,
      settings: { ...SETTINGS, rules: [LATER] },
    });
    const [old, fresh] = items;
    expect(old).toMatchObject({ handled: true, hidden: true });
    expect(fresh.handled).toBeUndefined();
    expect(fresh.hidden).toBeUndefined();
    expect(reviewItems.map((i) => i.id)).toEqual([fresh.id]);
    expect(decisions[old.id]).toBe("roll");
    expect(decisions[fresh.id]).toBe("backlog");
  });

  test("a rule-chosen Leave done in a newer note stays Leave and is not handled", () => {
    const sources = [
      earlier(
        "Daily/2026-11-15.md",
        ["- [ ] Stretch #habit"],
        new Set(["Stretch #habit"])
      ),
    ];
    const { items, reviewItems, decisions } = planSources({
      sources,
      settings: { ...SETTINGS, rules: [HABIT] },
    });
    expect(items[0].hidden).toBe(true);
    expect(items[0].handled).toBeUndefined();
    expect(reviewItems).toEqual([]);
    expect(decisions[items[0].id]).toBe("leave");
  });

  describe("sourceNeedsWrite", () => {
    const decidedFor = (sources, decisionsFor = (d) => d) => {
      const { plans, decisions } = planSources({
        sources,
        settings: { ...SETTINGS, rules: [HABIT] },
      });
      return applySources({
        plans,
        sources,
        decisions: decisionsFor(decisions),
      }).perSource[0];
    };

    test("an older note with only hidden Leaves is not written", () => {
      const sources = [
        earlier("Daily/2026-11-15.md", [
          "- [ ] Stretch #habit",
          "  - [x] done",
        ]),
      ];
      expect(sourceNeedsWrite(sources[0], decidedFor(sources))).toBe(false);
    });

    test("an older note with a todo to mark, cancel or delete is written", () => {
      const sources = [
        earlier("Daily/2026-11-15.md", [
          "- [ ] Stretch #habit",
          "- [ ] Pay rent",
        ]),
      ];
      expect(sourceNeedsWrite(sources[0], decidedFor(sources))).toBe(true);
      const cancelled = decidedFor(sources, (d) => ({
        ...d,
        "Daily/2026-11-15.md/0:1": "cancel",
      }));
      expect(sourceNeedsWrite(sources[0], cancelled)).toBe(true);
    });

    test("an older note whose todos are all left by hand is not written", () => {
      const sources = [earlier("Daily/2026-11-15.md", ["- [ ] Pay rent"])];
      const left = decidedFor(sources, (d) => ({
        ...d,
        "Daily/2026-11-15.md/0:0": "leave",
      }));
      expect(sourceNeedsWrite(sources[0], left)).toBe(false);
    });

    test("the previous note and the inbox are written as before", () => {
      const nothing = {
        movedLineIndices: [],
        cancelledLineIndices: [],
        deleteLineIndices: [],
        skippedLineIndices: [],
      };
      for (const kind of ["previous", "inbox"]) {
        expect(sourceNeedsWrite({ kind, sourceAction: "mark" }, nothing)).toBe(
          true
        );
        expect(sourceNeedsWrite({ kind, sourceAction: "none" }, nothing)).toBe(
          false
        );
        expect(
          sourceNeedsWrite(
            { kind, sourceAction: "none" },
            { ...nothing, cancelledLineIndices: [0] }
          )
        ).toBe(true);
      }
    });
  });

  test("the Templater notice names only the older notes that had something to write", () => {
    const sources = [
      { kind: "previous", name: "2026-11-20", sourceAction: "none" },
      earlier("Daily/2026-11-16.md", ["- [ ] Pay rent"]),
      earlier("Daily/2026-11-15.md", ["- [ ] Stretch #habit"]),
      { kind: "inbox", name: "Inbox", sourceAction: "delete" },
    ];
    const nothing = {
      movedLineIndices: [],
      cancelledLineIndices: [],
      deleteLineIndices: [],
      skippedLineIndices: [],
    };
    const perSource = [
      nothing,
      { ...nothing, movedLineIndices: [0] },
      nothing,
      nothing,
    ];
    // the previous note and the inbox are named as before, even with nothing
    // to write, so their notices keep their texts
    expect(
      templaterNoticeSources(sources, perSource).map((s) => s.name)
    ).toEqual(["2026-11-20", "2026-11-16", "Inbox"]);
  });

  test("without newer done keys nothing is handled", () => {
    const sources = [earlier("Daily/2026-11-15.md", ["- [ ] Old"])];
    const { items } = planSources({ sources, settings: SETTINGS });
    expect(items[0].handled).toBeUndefined();
  });

  test("applySources counts the left and handled items", () => {
    const sources = [
      earlier(
        "Daily/2026-11-15.md",
        [
          "- [ ] a",
          "- [ ] Stretch #habit",
          "- [ ] Old",
          "  - [x] done child",
          "  note",
        ],
        new Set(["Old"])
      ),
    ];
    const { plans, items, decisions } = planSources({
      sources,
      settings: { ...SETTINGS, rules: [HABIT] },
    });
    const applied = applySources({
      plans,
      sources,
      decisions: { ...decisions, [items[0].id]: "leave" },
    });
    const [perSource] = applied.perSource;
    // the hand-chosen Leave is counted, the hidden rule-chosen one is not
    expect(perSource.leftCount).toBe(1);
    expect(perSource.handledCount).toBe(1);
    expect(perSource.handledLineIndices).toEqual([2, 3, 4]);
  });

  test("insertSources keeps handled todos out of today's note", () => {
    const sources = [
      earlier(
        "Daily/2026-11-15.md",
        ["- [ ] Old", "  - [x] done child", "- [ ] Stranded"],
        new Set(["Old"])
      ),
    ];
    const { plans, decisions } = planSources({ sources, settings: SETTINGS });
    const applied = applySources({ plans, sources, decisions });
    const result = insertSources({
      content: "",
      entries: [
        {
          ...entriesOf(sources, applied)[0],
          handledLineIndices: applied.perSource[0].handledLineIndices,
        },
      ],
      // independent of skip existing
      settings: insertSettings(false),
    });
    expect(result.content).toBe("- [ ] Stranded\n");
    expect(result.perSource[0].todosDoneElsewhere).toBe(2);
    expect(result.perSource[0].retainedLineIndices).toEqual([0, 1]);
    expect(result.perSource[0].insertedTodos).toEqual(["- [ ] Stranded"]);
  });
});

describe("notices and guards for earlier notes", () => {
  const EARLIER = { kind: "earlier", name: "2026-11-14" };

  test("the label and the unchanged notice name the daily note", () => {
    expect(sourceLabel(EARLIER)).toBe("the daily note '2026-11-14'");
    expect(sourceUnchangedNotice(EARLIER)).toBe(
      "Rollover left the daily note '2026-11-14' unchanged: it was edited while the rollover was running."
    );
    expect(templaterNotice([EARLIER])).toContain(
      "Rollover left the daily note '2026-11-14' unchanged:"
    );
    expect(sourceWriteFailedNotice(EARLIER, new Error("boom"))).toContain(
      "the daily note '2026-11-14'"
    );
  });

  describe("rolloverNotice", () => {
    const base = (kind, name, rolledCount) => ({
      kind,
      name,
      sourceAction: "delete",
      removedEmptyTodos: 0,
      leftCount: 0,
      rolledCount,
    });
    const NOTICE = {
      templateHeadingNotFound: false,
      templateHeading: "none",
      todosAdded: 0,
      todosAlreadyPresent: 0,
      backlogCount: 0,
      backlogPath: "",
      cancelledCount: 0,
      sources: [],
    };

    test("earlier sources are summed before the inbox part", () => {
      expect(
        rolloverNotice({
          ...NOTICE,
          todosAdded: 7,
          sources: [
            base("previous", "2026-11-16", 2),
            base("earlier", "2026-11-15", 2),
            base("earlier", "2026-11-14", 1),
            base("inbox", "Inbox", 2),
          ],
        })
      ).toBe("- 7 todos rolled over (3 from earlier notes, 2 from Inbox). ");
    });

    test("one earlier source contributing", () => {
      expect(
        rolloverNotice({
          ...NOTICE,
          todosAdded: 3,
          sources: [
            base("previous", "2026-11-16", 2),
            base("earlier", "2026-11-15", 1),
          ],
        })
      ).toBe("- 3 todos rolled over (1 from an earlier note). ");
    });

    test("an earlier source that rolled nothing is not named", () => {
      expect(
        rolloverNotice({
          ...NOTICE,
          todosAdded: 2,
          sources: [
            base("previous", "2026-11-16", 2),
            base("earlier", "2026-11-15", 0),
          ],
        })
      ).toBe("- 2 todos rolled over. ");
    });

    test("done in a newer note, after the skipped line", () => {
      expect(rolloverNotice({ ...NOTICE, doneElsewhereCount: 2 })).toBe(
        "- 2 already done in a newer note."
      );
      expect(
        rolloverNotice({
          ...NOTICE,
          todosAlreadyPresent: 1,
          doneElsewhereCount: 1,
          backlogCount: 1,
          backlogPath: "Backlog",
        })
      ).toBe(
        [
          "- 1 line skipped (already in today's note).",
          "- 1 already done in a newer note.",
          "- 1 moved to backlog (Backlog).",
        ].join("\n")
      );
      expect(rolloverNotice({ ...NOTICE, doneElsewhereCount: 0 })).toBe("");
    });

    test("one left line per source", () => {
      expect(
        rolloverNotice({
          ...NOTICE,
          sources: [
            { ...base("previous", "2026-11-16", 0), leftCount: 1 },
            { ...base("earlier", "2026-11-15", 0), leftCount: 2 },
          ],
        })
      ).toBe("- 1 left in 2026-11-16.\n- 2 left in 2026-11-15.");
    });
  });

  describe("the inbox guard", () => {
    const paths = {
      inboxPath: "Inbox.md",
      todayPath: "Daily/2026-11-18.md",
      previousPath: "Daily/2026-11-17.md",
      backlogPath: "Backlog.md",
      earlierPaths: ["Daily/2026-11-15.md", "Daily/2026-11-14.md"],
    };

    test("an older note as the inbox conflicts", () => {
      expect(inboxPathConflicts(paths)).toBe(false);
      expect(
        inboxPathConflicts({ ...paths, inboxPath: "Daily/2026-11-14.md" })
      ).toBe(true);
      // earlierPaths is optional
      expect(inboxPathConflicts({ ...paths, earlierPaths: undefined })).toBe(
        false
      );
    });

    test("the notice", () => {
      expect(
        inboxGuardNotice({ inboxPath: "Daily/2026-11-17.md", earlierPaths: [] })
      ).toBe(INBOX_GUARD_NOTICE);
      expect(
        inboxGuardNotice({
          inboxPath: "Daily/2026-11-14.md",
          earlierPaths: paths.earlierPaths,
        })
      ).toBe(
        "The inbox note can't be today's note, a daily note the rollover reads or the backlog note. Change it in settings."
      );
    });
  });

  describe("the backlog guard", () => {
    const paths = {
      backlogPath: "Backlog.md",
      todayPath: "Daily/2026-11-18.md",
      previousPath: "Daily/2026-11-17.md",
      earlierPaths: ["Daily/2026-11-15.md"],
    };

    test("texts", () => {
      expect(BACKLOG_GUARD_NOTICE).toBe(
        "The backlog note can't be today's or the previous daily note. Change it in settings."
      );
      expect(BACKLOG_GUARD_EARLIER_NOTICE).toBe(
        "The backlog note can't be today's note or a daily note the rollover reads. Change it in settings."
      );
    });

    test("no conflict gives null", () => {
      expect(backlogPathConflict(paths)).toBe(null);
      expect(backlogPathConflict({ ...paths, backlogPath: null })).toBe(null);
      expect(backlogPathConflict({ ...paths, backlogPath: "" })).toBe(null);
      expect(
        backlogPathConflict({
          backlogPath: "Backlog.md",
          todayPath: paths.todayPath,
        })
      ).toBe(null);
    });

    test("today's or the previous note gives the existing text", () => {
      expect(
        backlogPathConflict({ ...paths, backlogPath: paths.todayPath })
      ).toBe(BACKLOG_GUARD_NOTICE);
      expect(
        backlogPathConflict({ ...paths, backlogPath: paths.previousPath })
      ).toBe(BACKLOG_GUARD_NOTICE);
    });

    test("an older note gives the new text", () => {
      expect(
        backlogPathConflict({ ...paths, backlogPath: "Daily/2026-11-15.md" })
      ).toBe(BACKLOG_GUARD_EARLIER_NOTICE);
    });
  });
});

describe("the backlog source", () => {
  function backlog(lines) {
    return backlogSource({
      file: { basename: "Backlog" },
      content: lines.join("\n"),
      lines,
      sections: getSections({
        lines,
        withChildren: true,
        doneStatusMarkers: "xX-",
      }),
    });
  }

  test("backlogSource", () => {
    const src = backlog(["- [ ] a"]);
    expect(src).toMatchObject({
      key: "backlog/",
      kind: "backlog",
      name: "Backlog",
      content: "- [ ] a",
      lines: ["- [ ] a"],
      sourceAction: "delete",
      keepHeadings: true,
      countRollover: false,
      flatten: true,
    });
    expect(src.file).toEqual({ basename: "Backlog" });
    expect(src.sections).toHaveLength(1);
  });

  test("every item stays, and an outcome rule does not choose", () => {
    const rule = {
      id: "r",
      enabled: true,
      match: "tag",
      value: "#someday",
      effect: "roll",
    };
    const { plans, decisions } = planSources({
      sources: [backlog(["- [ ] Learn Rust #someday", "- [ ] Fix bike"])],
      settings: { ...PLAN_SETTINGS, rules: [rule] },
    });
    expect(Object.values(decisions)).toEqual(["leave", "leave"]);
    expect(plans[0].items[0].rule.outcomeRule).toBeUndefined();
    expect(plans[0].items[0].rule.outcome).toBeUndefined();
  });

  test("a move rule still moves", () => {
    const rule = {
      id: "m",
      enabled: true,
      match: "tag",
      value: "#errands",
      effect: "move",
      target: "## Errands",
    };
    const { plans } = planSources({
      sources: [backlog(["- [ ] Buy soil #errands"])],
      settings: { ...PLAN_SETTINGS, rules: [rule] },
    });
    expect(plans[0].items[0].rule.moveTo).toBe("## Errands");
  });

  test("sourceNeedsWrite: only with lines to change", () => {
    const src = { kind: "backlog", sourceAction: "delete" };
    const none = {
      movedLineIndices: [],
      cancelledLineIndices: [],
      deleteLineIndices: [],
      skippedLineIndices: [],
    };
    expect(sourceNeedsWrite(src, none)).toBe(false);
    expect(sourceNeedsWrite(src, { ...none, movedLineIndices: [2] })).toBe(
      true
    );
  });
});

describe("bring back notices", () => {
  const BACKLOG = { kind: "backlog", name: "Backlog" };

  test("the backlog is named", () => {
    expect(sourceLabel(BACKLOG)).toBe("the backlog note 'Backlog'");
  });

  test("edited meanwhile", () => {
    expect(sourceUnchangedNotice(BACKLOG)).toBe(
      "Bring back left the backlog note 'Backlog' unchanged: it was edited while the dialog was open. Its todos were still added to today's note; remove them from the backlog yourself."
    );
  });

  test("write failed", () => {
    expect(sourceWriteFailedNotice(BACKLOG, new Error("locked"))).toBe(
      "Bring back couldn't write the backlog note 'Backlog' (locked), so it was left unchanged. Its todos were still added to today's note."
    );
  });

  const none = {
    broughtBack: 0,
    alreadyPresent: 0,
    cancelled: 0,
    name: "Backlog",
  };

  test("brought back", () => {
    expect(bringBackNotice({ ...none, broughtBack: 2 })).toBe(
      "Brought back 2 todos from Backlog."
    );
    expect(bringBackNotice({ ...none, broughtBack: 1 })).toBe(
      "Brought back 1 todo from Backlog."
    );
  });

  test("every part, in order", () => {
    expect(
      bringBackNotice({
        broughtBack: 2,
        alreadyPresent: 1,
        cancelled: 1,
        name: "Backlog",
        templateHeadingNotFound: true,
        templateHeading: "## Tasks",
      })
    ).toBe(
      "Rollover couldn't find '## Tasks' in today's daily note. Rolling todos to end of file.\nBrought back 2 todos from Backlog.\n- 1 was already in today's note.\n- 1 cancelled."
    );
    expect(bringBackNotice({ ...none, alreadyPresent: 2 })).toBe(
      "- 2 were already in today's note."
    );
  });

  test("nothing to say", () => {
    expect(bringBackNotice(none)).toBe("");
  });
});
