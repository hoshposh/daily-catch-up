import { describe, expect, test } from "vitest";
import { getSections } from "./get-todos.js";
import {
  OUTCOMES,
  applyDecisions,
  bumpRolledCounts,
  defaultDecisions,
  headingLabel,
  isStale,
  itemLabel,
  needsReview,
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
