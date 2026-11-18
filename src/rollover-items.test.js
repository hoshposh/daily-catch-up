import { describe, expect, test } from "vitest";
import { getSections } from "./get-todos.js";
import { dropEmptyTodos } from "./insert-todos.js";
import { applyPlan, planDecisions, planInsert } from "./rollover-plan.js";
import {
  OUTCOMES,
  applyDecisions,
  bumpRolledCounts,
  countOutcomes,
  defaultDecisions,
  headingLabel,
  isStale,
  itemLabel,
  needsReview,
  rebaseSections,
  skippedLinesToDelete,
  summarizeDecisions,
  toItems,
} from "./rollover-items.js";

const lines = [
  "# Work",
  "- [ ] Ship [rolled:: 5]",
  "  - [x] Changelog",
  "  - [ ] Tag",
  "- [ ] Ship",
  "## Home",
  "- [ ] Laundry",
];
const sections = getSections({
  lines,
  withChildren: true,
  skipCompletedChildren: true,
});
const found = sections.flatMap((s) => s.incompleteLineIndices);

describe("rollover items", () => {
  test("fixture line indices", () => {
    expect(sections[0].incompleteLineIndices).toEqual([1, 3, 4]);
    expect(sections[0].skippedLineIndices).toEqual([2]);
    expect(sections[1].incompleteLineIndices).toEqual([6]);
    expect(OUTCOMES).toEqual(["roll", "backlog", "cancel", "leave"]);
  });

  test("item ids carry the prefix", () => {
    const ids = toItems(sections, true, "inbox/").map((item) => item.id);
    expect(ids.every((id) => id.startsWith("inbox/"))).toBe(true);
    expect(toItems(sections, true).map((item) => item.id)[0]).toBe("0:0");
  });

  test("groups heads with their nested lines", () => {
    const items = toItems(sections, true);
    expect(items.map((i) => [i.id, i.lines.length, i.count])).toEqual([
      ["0:0", 2, 5],
      ["0:2", 1, 0],
      ["1:0", 1, 0],
    ]);
    expect(items[0]).toMatchObject({
      sectionIndex: 0,
      headingPath: ["# Work"],
      start: 0,
      end: 2,
      lineIndices: [1, 3],
    });
  });

  test("without children every line is an item", () => {
    const flat = getSections({ lines, withChildren: false });
    expect(toItems(flat, false).length).toBe(4); // Ship, Tag, Ship, Laundry
  });

  test("identical lines are separate items with separate decisions", () => {
    const items = toItems(sections, true);
    const r = applyDecisions({
      sections,
      items,
      foundLineIndices: found,
      decisions: { "0:0": "roll", "0:2": "cancel", "1:0": "roll" },
    });
    expect(r.sections[0].incompleteTodos).toEqual([
      "- [ ] Ship [rolled:: 5]",
      "  - [ ] Tag",
    ]);
    expect(r.sections[0].incompleteLineIndices).toEqual([1, 3]);
    expect(r.cancelledLineIndices).toEqual([4]);
    expect(r.skippedLineIndices).toEqual([2]);
    expect(r.sections[0].skippedLineIndices).toEqual([2]);
    expect(r.deleteLineIndices).toEqual([1, 3, 6]);
  });

  test("delete never removes Leave/Cancel items or their skipped children", () => {
    const items = toItems(sections, true);
    const r = applyDecisions({
      sections,
      items,
      foundLineIndices: found,
      decisions: { "0:0": "leave", "0:2": "roll", "1:0": "backlog" },
    });
    expect(r.deleteLineIndices).toEqual([4, 6]);
    expect(r.skippedLineIndices).toEqual([]); // line 2 belongs to the Leave item
    expect(r.movedLineIndices).toEqual([4, 6]);
    expect(r.backlogItems.map((i) => i.id)).toEqual(["1:0"]);
    expect(r.sections.length).toBe(1);
    expect(r.sections[0].incompleteLineIndices).toEqual([4]);
    expect("skippedLineIndices" in r.sections[0]).toBe(false);
  });

  test("backlog items keep their skipped children and leave sections out", () => {
    const items = toItems(sections, true);
    const r = applyDecisions({
      sections,
      items,
      foundLineIndices: found,
      decisions: { "0:0": "backlog", "0:2": "leave", "1:0": "leave" },
    });
    expect(r.sections).toEqual([]);
    expect(r.skippedLineIndices).toEqual([2]);
    expect(r.movedLineIndices).toEqual([1, 3]);
    expect(r.deleteLineIndices).toEqual([1, 3]);
    expect(r.cancelledLineIndices).toEqual([]);
  });

  test("a missing decision rolls and an unknown one leaves the item alone", () => {
    const items = toItems(sections, true);
    const r = applyDecisions({
      sections,
      items,
      foundLineIndices: found,
      decisions: { "0:0": "bogus" },
    });
    expect(r.movedLineIndices).toEqual([4, 6]);
    expect(r.deleteLineIndices).toEqual([4, 6]);
    expect(r.skippedLineIndices).toEqual([]);
  });

  test("open todos under a done parent or a plain bullet are their own items", () => {
    const noteLines = [
      "- [ ] A",
      "- [x] B",
      "  - [ ] B1",
      "- Notes",
      "  - [ ] N1",
    ];
    const secs = getSections({ lines: noteLines, withChildren: true });
    expect(secs[0].incompleteLineIndices).toEqual([0, 2, 4]);
    const items = toItems(secs, true);
    expect(items.map((i) => [i.id, i.lineIndices])).toEqual([
      ["0:0", [0]],
      ["0:1", [2]],
      ["0:2", [4]],
    ]);
    const r = applyDecisions({
      sections: secs,
      items,
      foundLineIndices: [0, 2, 4],
      decisions: { "0:0": "cancel", "0:1": "roll", "0:2": "roll" },
    });
    expect(r.cancelledLineIndices).toEqual([0]);
    expect(r.deleteLineIndices).toEqual([2, 4]);
    expect(bumpRolledCounts(secs, true)[0].incompleteTodos).toEqual([
      "- [ ] A [rolled:: 1]",
      "  - [ ] B1 [rolled:: 1]",
      "  - [ ] N1 [rolled:: 1]",
    ]);
  });

  test("does not mutate its inputs", () => {
    const before = JSON.stringify(sections);
    const items = toItems(sections, true);
    applyDecisions({
      sections,
      items,
      foundLineIndices: found,
      decisions: { "0:0": "cancel", "0:2": "roll", "1:0": "roll" },
    });
    bumpRolledCounts(sections, true);
    expect(JSON.stringify(sections)).toBe(before);
  });

  test("lines found outside any item are still deleted", () => {
    const items = toItems(sections, true);
    const r = applyDecisions({
      sections,
      items,
      foundLineIndices: [...found, 9],
      decisions: { "0:0": "roll", "0:2": "roll", "1:0": "roll" },
    });
    expect(r.deleteLineIndices).toEqual([1, 3, 4, 6, 9]);
  });

  test("staleness needs tracking and a threshold", () => {
    const [ship] = toItems(sections, true);
    expect(
      isStale(ship, { trackRolloverCount: true, staleAfterRollovers: 5 })
    ).toBe(true);
    expect(
      isStale(ship, { trackRolloverCount: true, staleAfterRollovers: 6 })
    ).toBe(false);
    expect(
      isStale(ship, { trackRolloverCount: false, staleAfterRollovers: 5 })
    ).toBe(false);
    expect(
      isStale(ship, { trackRolloverCount: true, staleAfterRollovers: 0 })
    ).toBe(false);
  });

  test("default decisions send stale items to the backlog only when enabled", () => {
    const items = toItems(sections, true);
    const s = {
      trackRolloverCount: true,
      staleAfterRollovers: 5,
      staleBehavior: "backlog",
    };
    expect(defaultDecisions(items, { ...s, backlogEnabled: true })["0:0"]).toBe(
      "backlog"
    );
    expect(defaultDecisions(items, { ...s, backlogEnabled: true })["0:2"]).toBe(
      "roll"
    );
    expect(
      defaultDecisions(items, { ...s, backlogEnabled: false })["0:0"]
    ).toBe("roll");
    expect(
      defaultDecisions(items, {
        ...s,
        staleBehavior: "keep",
        backlogEnabled: true,
      })["0:0"]
    ).toBe("roll");
  });

  test("needsReview", () => {
    const items = toItems(sections, true);
    const s = { trackRolloverCount: true, staleAfterRollovers: 5 };
    expect(needsReview("off", items, s)).toBe(false);
    expect(needsReview("stale", items, s)).toBe(true);
    expect(needsReview("stale", items, { ...s, staleAfterRollovers: 9 })).toBe(
      false
    );
    expect(needsReview("always", items, s)).toBe(true);
    expect(needsReview("always", [], s)).toBe(false);
  });

  test("bumpRolledCounts touches only head lines", () => {
    const bumped = bumpRolledCounts(sections, true);
    expect(bumped[0].incompleteTodos).toEqual([
      "- [ ] Ship [rolled:: 6]",
      "  - [ ] Tag",
      "- [ ] Ship [rolled:: 1]",
    ]);
    expect(bumped[0].incompleteLineIndices).toEqual(
      sections[0].incompleteLineIndices
    );
    expect(bumped[0].skippedLineIndices).toEqual([2]);
    expect(bumped[1].incompleteTodos).toEqual(["- [ ] Laundry [rolled:: 1]"]);
  });

  test("bumpRolledCounts without children bumps every line", () => {
    const flat = getSections({ lines, withChildren: false });
    expect(bumpRolledCounts(flat, false)[0].incompleteTodos).toEqual([
      "- [ ] Ship [rolled:: 6]",
      "  - [ ] Tag [rolled:: 1]",
      "- [ ] Ship [rolled:: 1]",
    ]);
  });

  test("labels and summary", () => {
    const [ship] = toItems(sections, true);
    expect(itemLabel(ship)).toBe("Ship (+1 nested)");
    expect(headingLabel(["# Work", "## Release"])).toBe("Work › Release");
    expect(headingLabel([])).toBe("(no heading)");
    expect(summarizeDecisions({ a: "roll", b: "roll", c: "leave" })).toBe(
      "2 roll, 1 left"
    );
    expect(summarizeDecisions({})).toBe("nothing to do");
    expect(
      summarizeDecisions({
        a: "leave",
        b: "cancel",
        c: "backlog",
        d: "roll",
      })
    ).toBe("1 roll, 1 to backlog, 1 cancelled, 1 left");
  });

  test("itemLabel strips markers, blockquotes and the counter", () => {
    const label = (line) => itemLabel({ lines: [line], count: 0 });
    expect(label("  * [/] Plan [rolled:: 2] 📅 2026-11-10")).toBe(
      "Plan 📅 2026-11-10"
    );
    expect(label("> - [ ] Call mom")).toBe("Call mom");
    expect(label("> > + [ ] Deep")).toBe("Deep");
  });
});

describe("skipped lines to delete", () => {
  const withEmpty = [
    "# A",
    "- [ ]",
    "  - [x] under empty",
    "- [ ] Real",
    "  - [x] under real",
    "## B",
    "- [ ]",
    "  - [x] alone",
  ];
  const all = getSections({
    lines: withEmpty,
    withChildren: true,
    skipCompletedChildren: true,
  });
  const allSkipped = all.flatMap((s) => s.skippedLineIndices ?? []);
  const kept = dropEmptyTodos(all).sections;
  const items = toItems(kept, true);

  test("fixture", () => {
    expect(allSkipped).toEqual([2, 4, 7]);
    expect(items.map((i) => i.lineIndices)).toEqual([[3]]);
  });

  test("with every item rolled, all skipped lines go, including those of dropped empty todos", () => {
    expect(
      skippedLinesToDelete({
        skippedLineIndices: allSkipped,
        sections: kept,
        items,
        decisions: {},
      })
    ).toEqual([2, 4, 7]);
  });

  test("backlog moves its skipped lines like roll", () => {
    expect(
      skippedLinesToDelete({
        skippedLineIndices: allSkipped,
        sections: kept,
        items,
        decisions: { [items[0].id]: "backlog" },
      })
    ).toEqual([2, 4, 7]);
  });

  test("skipped lines of Leave and Cancel items stay", () => {
    for (const outcome of ["leave", "cancel"]) {
      expect(
        skippedLinesToDelete({
          skippedLineIndices: allSkipped,
          sections: kept,
          items,
          decisions: { [items[0].id]: outcome },
        })
      ).toEqual([2, 7]);
    }
  });

  test("matches applyDecisions when no empty todos were dropped", () => {
    const decisions = { "0:0": "leave", "0:2": "roll", "1:0": "roll" };
    const all = toItems(sections, true);
    const decided = applyDecisions({
      sections,
      items: all,
      decisions,
      foundLineIndices: found,
    });
    expect(
      skippedLinesToDelete({
        skippedLineIndices: sections.flatMap((s) => s.skippedLineIndices ?? []),
        sections,
        items: all,
        decisions,
      })
    ).toEqual(decided.skippedLineIndices);
  });
});

describe("count outcomes", () => {
  const items = toItems(sections, true); // ids 0:0, 0:2, 1:0

  test("counts items per outcome; missing rolls, unknown leaves", () => {
    expect(countOutcomes(items, { "0:0": "backlog", "0:2": "bogus" })).toEqual({
      roll: 1,
      backlog: 1,
      cancel: 0,
      leave: 1,
    });
    expect(
      countOutcomes(items, { "0:0": "cancel", "0:2": "leave", "1:0": "roll" })
    ).toEqual({ roll: 1, backlog: 0, cancel: 1, leave: 1 });
  });

  test("ignores decisions for ids that are not items", () => {
    expect(countOutcomes([], { "9:9": "cancel" })).toEqual({
      roll: 0,
      backlog: 0,
      cancel: 0,
      leave: 0,
    });
  });
});

describe("items around dropped empty todos", () => {
  const plan = (noteLines, skipCompletedChildren = false) => {
    const all = getSections({
      lines: noteLines,
      withChildren: true,
      skipCompletedChildren,
    });
    const kept = dropEmptyTodos(all, { recordDropped: true }).sections;
    return {
      all,
      kept,
      items: toItems(kept, true),
      found: all.flatMap((s) => s.incompleteLineIndices),
      skipped: all.flatMap((s) => s.skippedLineIndices ?? []),
    };
  };

  test("a dropped empty child stays inside its item", () => {
    const { kept, items } = plan(["- [ ] P", "  - [ ]", "  - [ ] c"]);
    expect(items.map((i) => i.lineIndices)).toEqual([[0, 2]]);
    expect(bumpRolledCounts(kept, true)[0].incompleteTodos).toEqual([
      "- [ ] P [rolled:: 1]",
      "  - [ ] c",
    ]);
  });

  test("a dropped top-level empty todo ends the item above it", () => {
    const { items } = plan(["- [ ] A", "- [ ]", "  - [ ] c"]);
    expect(items.map((i) => i.lineIndices)).toEqual([[0], [2]]);
  });

  test("an empty todo dropped from a Cancel or Leave item is kept, from a Roll item deleted", () => {
    const { kept, items, found } = plan([
      "- [ ] P",
      "  - [ ]",
      "  - [ ] c",
      "- [ ] Q",
      "  - [ ]",
    ]);
    expect(items.map((i) => i.lineIndices)).toEqual([[0, 2], [3]]);
    for (const outcome of ["cancel", "leave"]) {
      const r = applyDecisions({
        sections: kept,
        items,
        foundLineIndices: found,
        decisions: { "0:0": outcome, "0:2": "roll" },
      });
      expect(r.deleteLineIndices).toEqual([3, 4]);
    }
    const r = applyDecisions({
      sections: kept,
      items,
      foundLineIndices: found,
      decisions: { "0:0": "backlog", "0:2": "leave" },
    });
    expect(r.deleteLineIndices).toEqual([0, 1, 2]);
  });

  test("an empty todo under a plain bullet belongs to no item", () => {
    const { kept, items, found } = plan(["- [ ] A", "- Notes", "  - [ ]"]);
    const r = applyDecisions({
      sections: kept,
      items,
      foundLineIndices: found,
      decisions: { "0:0": "leave" },
    });
    expect(r.deleteLineIndices).toEqual([2]);
  });

  test("a skipped child belongs to the todo it is indented under", () => {
    const noteLines = [
      "- [ ]",
      "  - [ ] c",
      "    - [x] under c",
      "  - [x] under the empty todo",
    ];
    const { kept, items, skipped } = plan(noteLines, true);
    expect(skipped).toEqual([2, 3]);
    expect(items.map((i) => i.lineIndices)).toEqual([[1]]);
    expect(
      skippedLinesToDelete({
        skippedLineIndices: skipped,
        sections: kept,
        items,
        decisions: { "0:0": "leave" },
        lines: noteLines,
      })
    ).toEqual([3]);
    const r = applyDecisions({
      sections: kept,
      items,
      foundLineIndices: [0, 1],
      decisions: { "0:0": "roll" },
      lines: noteLines,
    });
    expect(r.skippedLineIndices).toEqual([2]);
  });
});

describe("itemLabel with a status character outside the Basic Multilingual Plane", () => {
  test("strips the whole checkbox", () => {
    expect(itemLabel({ lines: ["- [🔥] Task"], count: 0 })).toBe("Task");
  });
});

describe("rules", () => {
  const rule = (match, value, effect, extra = {}) => ({
    id: `${match}:${value}:${effect}`,
    enabled: true,
    match,
    value,
    effect,
    ...extra,
  });
  const planNote = (note, rules, extra = {}) => {
    const noteLines = note.split("\n");
    return planDecisions({
      sections: getSections({
        lines: noteLines,
        withChildren: true,
        skipCompletedChildren: true,
      }),
      lines: noteLines,
      settings: {
        removeEmptyTodos: false,
        rolloverChildren: true,
        trackRolloverCount: true,
        staleAfterRollovers: 5,
        staleBehavior: "backlog",
        backlogEnabled: true,
        cancelEnabled: true,
        rules,
        ...extra,
      },
    });
  };
  const insert = (plan, decided) =>
    planInsert({
      sections: decided.rolledSections,
      todayContent: "",
      settings: {
        skipExistingTodos: false,
        rolloverChildren: true,
        trackRolloverCount: true,
        doneStatusMarkers: "xX-",
      },
      noStaleLineIndices: decided.noStaleLineIndices,
    });

  test("a rule outcome beats the stale default", () => {
    const plan = planNote("## Inbox\n- [ ] x [rolled:: 9]", [
      rule("heading", "Inbox", "roll"),
    ]);
    expect(plan.decisions[plan.items[0].id]).toBe("roll");
    expect(plan.items[0].rule.outcomeRule.value).toBe("Inbox");
  });

  test("no stale count: never stale, never a stale review, no bump", () => {
    const plan = planNote(
      "- [ ] x #waiting [rolled:: 9]\n- [ ] y [rolled:: 9]",
      [rule("tag", "waiting", "noStale")]
    );
    const [waiting, other] = plan.items;
    const stale = { trackRolloverCount: true, staleAfterRollovers: 5 };
    expect(plan.decisions[waiting.id]).toBe("roll");
    expect(plan.decisions[other.id]).toBe("backlog");
    expect(isStale(waiting, stale)).toBe(false);
    expect(needsReview("stale", [waiting], stale)).toBe(false);

    const decided = applyPlan({
      plan,
      decisions: { [waiting.id]: "roll", [other.id]: "roll" },
    });
    expect(decided.noStaleLineIndices).toEqual([0]);
    expect(insert(plan, decided).sections[0].incompleteTodos).toEqual([
      "- [ ] x #waiting [rolled:: 9]",
      "- [ ] y [rolled:: 10]",
    ]);
  });

  test("moved items gather under their target after the regular sections", () => {
    const note = [
      "## Top 3 today",
      "- [ ] a",
      "- [ ] b",
      "## Work",
      "- [ ] c",
      "- [ ] d #inbox",
    ].join("\n");
    const plan = planNote(note, [
      rule("heading", "Top 3 today", "move", { target: "Inbox" }),
      rule("tag", "inbox", "move", { target: "## inbox" }),
    ]);
    const decided = applyPlan({ plan, decisions: plan.decisions });
    expect(decided.rolledSections).toEqual([
      {
        headingPath: ["## Work"],
        incompleteTodos: ["- [ ] c"],
        incompleteLineIndices: [4],
      },
      {
        headingPath: ["## Inbox"],
        moveTo: "## Inbox",
        incompleteTodos: ["- [ ] a", "- [ ] b", "- [ ] d #inbox"],
        incompleteLineIndices: [1, 2, 5],
      },
    ]);
    expect([...decided.movedLineIndices].sort()).toEqual([1, 2, 4, 5]);
  });

  test("a moved item that is not Roll does not move", () => {
    const plan = planNote("## Top 3 today\n- [ ] a", [
      rule("heading", "Top 3 today", "move", { target: "Inbox" }),
    ]);
    const decided = applyPlan({
      plan,
      decisions: { [plan.items[0].id]: "leave" },
    });
    expect(decided.rolledSections).toEqual([]);
  });

  test("a moved item keeps a dropped empty child inside it", () => {
    const plan = planNote(
      "## Top 3 today\n- [ ] a\n  - [ ] \n  - [ ] b",
      [rule("heading", "Top 3 today", "move", { target: "Inbox" })],
      { removeEmptyTodos: true, staleBehavior: "keep" }
    );
    expect(plan.items).toHaveLength(1);
    const decided = applyPlan({ plan, decisions: plan.decisions });
    expect(insert(plan, decided).sections[0].incompleteTodos).toEqual([
      "- [ ] a [rolled:: 1]",
      "  - [ ] b",
    ]);
  });
});

describe("re-basing indentation", () => {
  // the section for the lines at `indices` of `note`, as getSections() has it
  const sectionOf = (note, indices, extra = {}) => ({
    headingPath: [],
    incompleteTodos: indices.map((i) => note[i]),
    incompleteLineIndices: indices,
    ...extra,
  });

  test("a todo under a plain bullet starts at column 0, its nested lines with it", () => {
    const note = [
      "- [ ] Laundry",
      "- Garden",
      "    - [ ] buy soil",
      "        - peat free",
    ];
    const [section] = rebaseSections([sectionOf(note, [0, 2, 3])], note);
    expect(section.incompleteTodos).toEqual([
      "- [ ] Laundry",
      "- [ ] buy soil",
      "    - peat free",
    ]);
    expect(section.incompleteLineIndices).toEqual([0, 2, 3]);
  });

  test("a todo nested under one that goes to the same place keeps its indentation", () => {
    const note = [
      "- [ ] Ship release",
      "  - [x] Tag version",
      "  - [ ] Generate Escrow",
    ];
    const sections = [sectionOf(note, [0, 2])];
    expect(rebaseSections(sections, note)[0].incompleteTodos).toEqual([
      "- [ ] Ship release",
      "  - [ ] Generate Escrow",
    ]);
  });

  test("a nested line follows its head when the head is re-based", () => {
    const note = [
      "- Garden",
      "\t- [ ] buy soil",
      "\t\t- [x] measure beds",
      "\t\t\t- [ ] water",
    ];
    const sections = [sectionOf(note, [1, 3])];
    expect(rebaseSections(sections, note)[0].incompleteTodos).toEqual([
      "- [ ] buy soil",
      "\t\t- [ ] water",
    ]);
  });

  test("a todo whose parent goes somewhere else is a head where it lands", () => {
    const note = [
      "## Work",
      "- [ ] Plan offsite",
      "  - [ ] Book room @errands",
    ];
    const rebased = rebaseSections(
      [sectionOf(note, [1]), sectionOf(note, [2], { moveTo: "## Errands" })],
      note
    );
    expect(rebased[1].incompleteTodos).toEqual(["- [ ] Book room @errands"]);
  });

  test("blank lines, blockquotes and lines already at column 0 are kept", () => {
    const note = [
      "- [ ] a",
      "",
      "  - [ ] b",
      "> - [ ] quoted",
      ">   - [ ] nested quote",
    ];
    const sections = [sectionOf(note, [0, 1, 2, 3, 4])];
    expect(rebaseSections(sections, note)[0].incompleteTodos).toEqual(note);
  });

  test("the rolled text is re-based, not the note's line", () => {
    const note = ["- Garden", "    - [ ] buy soil"];
    const section = sectionOf(note, [1]);
    section.incompleteTodos = ["    - [ ] buy soil [rolled:: 1]"];
    expect(rebaseSections([section], note)[0].incompleteTodos).toEqual([
      "- [ ] buy soil [rolled:: 1]",
    ]);
  });
});
