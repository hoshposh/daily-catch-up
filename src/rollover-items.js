// Pure helpers for the migration review: group the todos a rollover found into
// items (a todo plus its nested lines), decide each item's outcome, and turn
// those decisions into line positions in the previous day's note. Line
// positions come from `getSections()`, never from line text, so identical todos
// stay separate.

import {
  parseRolledCount,
  setRolledCount,
  stripRolledCount,
} from "./rolled-count.js";

export const OUTCOMES = ["roll", "backlog", "cancel", "leave"];

const indentationOf = (line) => line.search(/\S/);

// The empty todos dropped from `section` (dropEmptyTodos with recordDropped):
// position in the note -> line
const droppedLines = (section) =>
  new Map(
    (section.droppedLineIndices ?? []).map((index, i) => [
      index,
      section.droppedTodos[i],
    ])
  );

// End (exclusive) of the item that starts at `start` in `section`: the head
// plus the following lines that are its nested lines. A following line extends
// the item only if it is indented deeper than the head and nothing lies
// between it and the line before, in the note, but skipped completed children
// and dropped empty todos indented deeper than the head. Any other open todo
// (under a done parent, a plain bullet or a dropped top-level empty todo) is
// its own item. Without children, one line.
function itemEnd(section, start, withChildren) {
  if (!withChildren) return start + 1;
  const todos = section.incompleteTodos;
  const indices = section.incompleteLineIndices;
  const skipped = new Set(section.skippedLineIndices ?? []);
  const dropped = droppedLines(section);
  const headIndentation = indentationOf(todos[start]);
  const isNested = (i) =>
    skipped.has(i) ||
    (dropped.has(i) && indentationOf(dropped.get(i)) > headIndentation);
  let end = start + 1;
  while (end < todos.length && indentationOf(todos[end]) > headIndentation) {
    for (let i = indices[end - 1] + 1; i < indices[end]; i++) {
      if (!isNested(i)) return end;
    }
    end++;
  }
  return end;
}

export function toItems(sections, withChildren) {
  const items = [];
  sections.forEach((section, sectionIndex) => {
    const todos = section.incompleteTodos;
    for (let start = 0; start < todos.length; ) {
      const end = itemEnd(section, start, withChildren);
      const lines = todos.slice(start, end);
      items.push({
        id: `${sectionIndex}:${start}`,
        sectionIndex,
        headingPath: section.headingPath,
        start,
        end,
        lines,
        lineIndices: section.incompleteLineIndices.slice(start, end),
        count: parseRolledCount(lines[0]),
      });
      start = end;
    }
  });
  return items;
}

export function isStale(item, { trackRolloverCount, staleAfterRollovers }) {
  return !!(
    trackRolloverCount &&
    staleAfterRollovers > 0 &&
    item.count >= staleAfterRollovers
  );
}

export function defaultDecisions(items, settings) {
  const toBacklog =
    settings.staleBehavior === "backlog" && settings.backlogEnabled;
  const decisions = {};
  for (const item of items) {
    decisions[item.id] =
      toBacklog && isStale(item, settings) ? "backlog" : "roll";
  }
  return decisions;
}

export function needsReview(mode, items, staleSettings) {
  if (mode === "always") return items.length > 0;
  if (mode === "stale") return items.some((i) => isStale(i, staleSettings));
  return false;
}

// Who owns the lines of a section that are in no item: its skipped completed
// children and the empty todos dropped from it. `indentation` maps every line
// the section knows (position in the note) to its indentation; a skipped
// child's comes from `lines`, and without them it is unknown (Infinity), so
// the child is taken to sit under the line above it. `itemAt` maps the lines
// of the section's items to their item.
function ownership(section, sectionIndex, items, lines) {
  const indentation = new Map();
  section.incompleteLineIndices.forEach((index, i) => {
    indentation.set(index, indentationOf(section.incompleteTodos[i]));
  });
  for (const [index, line] of droppedLines(section)) {
    indentation.set(index, indentationOf(line));
  }
  for (const index of section.skippedLineIndices ?? []) {
    const line = lines?.[index];
    indentation.set(index, line === undefined ? Infinity : indentationOf(line));
  }
  const itemAt = new Map();
  for (const item of items) {
    if (item.sectionIndex !== sectionIndex) continue;
    for (const index of item.lineIndices) itemAt.set(index, item);
  }
  return { indentation, itemAt };
}

// The item a skipped or dropped line belongs to: the one holding the nearest
// line above it that is indented less, walking up through skipped children and
// dropped empty todos. Only lines the section knows count, with none in
// between, so a line under a plain bullet or a done todo belongs to no item,
// and neither does one under a dropped top-level empty todo. Null then.
function ownerOf({ indentation, itemAt }, line) {
  const own = indentation.get(line);
  for (let i = line - 1; indentation.has(i); i--) {
    if (indentation.get(i) < own) {
      return itemAt.get(i) ?? ownerOf({ indentation, itemAt }, i);
    }
  }
  return null;
}

// An item without a decision rolls, like defaultDecisions without staleness.
// An unknown outcome is treated as "leave", which touches nothing.
const outcomeOf = (decisions, item) => decisions[item.id] ?? "roll";

// How many items get each outcome, read the way applyDecisions reads them: a
// missing decision rolls, an unknown outcome leaves
export function countOutcomes(items, decisions) {
  const counts = { roll: 0, backlog: 0, cancel: 0, leave: 0 };
  for (const item of items) {
    const outcome = outcomeOf(decisions, item);
    counts[outcome in counts ? outcome : "leave"]++;
  }
  return counts;
}

/**
 * Turns the decisions into the sections to roll (Roll items only), the
 * Backlog items and the line positions to change in the previous day's note.
 *
 * Skipped completed children and dropped empty todos belong to the item they
 * are indented under (see ownerOf). Delete removes them with a Roll or Backlog
 * item, or when they belong to no item, and never from a Cancel or Leave item.
 *
 * @param {object} args
 * @param {object[]} args.sections - the sections `items` were built from
 * @param {object[]} args.items - from toItems()
 * @param {Record<string, string>} args.decisions - item id -> outcome
 * @param {number[]} args.foundLineIndices - every todo line the parser found,
 *   empty todos included
 * @param {string[]} [args.lines] - the note's lines, which tell which todo a
 *   skipped child sits under
 */
export function applyDecisions({
  sections,
  items,
  decisions,
  foundLineIndices,
  lines,
}) {
  const outcomes = items.map((item) => outcomeOf(decisions, item));
  const moves = (outcome) => outcome === "roll" || outcome === "backlog";
  const keptItems = items.filter((_, i) => outcomes[i] === "roll");
  const backlogItems = items.filter((_, i) => outcomes[i] === "backlog");
  const cancelled = items.filter((_, i) => outcomes[i] === "cancel");
  const left = items.filter(
    (_, i) => !["roll", "backlog", "cancel"].includes(outcomes[i])
  );
  const movedItemIds = new Set(
    items.filter((_, i) => moves(outcomes[i])).map((item) => item.id)
  );
  const owners = sections.map((section, sectionIndex) =>
    ownership(section, sectionIndex, items, lines)
  );
  // whether a line outside the items belongs to a Cancel or Leave item
  const isHeld = (sectionIndex, line) => {
    const owner = ownerOf(owners[sectionIndex], line);
    return owner !== null && !movedItemIds.has(owner.id);
  };

  const movedLineIndices = items
    .filter((_, i) => moves(outcomes[i]))
    .flatMap((item) => item.lineIndices);
  const cancelledLineIndices = cancelled.flatMap((item) => item.lineIndices);
  const kept = new Set([
    ...cancelledLineIndices,
    ...left.flatMap((item) => item.lineIndices),
  ]);
  // an empty todo dropped from inside a Cancel or Leave item stays with it
  sections.forEach((section, sectionIndex) => {
    for (const line of section.droppedLineIndices ?? []) {
      if (isHeld(sectionIndex, line)) kept.add(line);
    }
  });
  const deleteLineIndices = foundLineIndices.filter((i) => !kept.has(i));

  // the skipped lines that move with a Roll or Backlog item
  const skippedKept = (sectionIndex) =>
    (sections[sectionIndex].skippedLineIndices ?? []).filter((line) => {
      const owner = ownerOf(owners[sectionIndex], line);
      return owner !== null && movedItemIds.has(owner.id);
    });

  const outSections = [];
  const skippedLineIndices = [];
  sections.forEach((section, sectionIndex) => {
    const mine = keptItems.filter((item) => item.sectionIndex === sectionIndex);
    const skipped = skippedKept(sectionIndex);
    skippedLineIndices.push(...skipped);
    if (mine.length === 0) return;
    const next = {
      ...section,
      incompleteTodos: mine.flatMap((item) => item.lines),
      incompleteLineIndices: mine.flatMap((item) => item.lineIndices),
    };
    delete next.skippedLineIndices;
    if (skipped.length > 0) next.skippedLineIndices = skipped;
    outSections.push(next);
  });

  return {
    sections: outSections,
    backlogItems,
    movedLineIndices,
    cancelledLineIndices,
    deleteLineIndices,
    skippedLineIndices,
  };
}

/**
 * The skipped completed children (see skipCompletedChildren) that "delete"
 * removes from the previous note: every one the parser found, as before review
 * existed, except those that belong to a Cancel or Leave item.
 *
 * `applyDecisions` only sees the sections left after empty todos were dropped,
 * so its `skippedLineIndices` miss the completed children of a dropped empty
 * todo. The empty todo itself is still deleted, so its children must go too.
 *
 * @param {object} args
 * @param {number[]} args.skippedLineIndices - every skipped line the parser
 *   found, before empty todos were dropped
 * @param {object[]} args.sections - the sections `items` were built from
 * @param {object[]} args.items
 * @param {Record<string, string>} args.decisions
 * @param {string[]} [args.lines] - the note's lines, which tell which todo a
 *   skipped child sits under
 * @returns {number[]}
 */
export function skippedLinesToDelete({
  skippedLineIndices,
  sections,
  items,
  decisions,
  lines,
}) {
  const held = new Set();
  sections.forEach((section, sectionIndex) => {
    const owners = ownership(section, sectionIndex, items, lines);
    for (const line of section.skippedLineIndices ?? []) {
      const owner = ownerOf(owners, line);
      const outcome = owner === null ? null : outcomeOf(decisions, owner);
      if (owner !== null && outcome !== "roll" && outcome !== "backlog") {
        held.add(line);
      }
    }
  });
  return skippedLineIndices.filter((line) => !held.has(line));
}

// Add one to the counter on each item's first line. Other lines and all
// indices stay as they are.
export function bumpRolledCounts(sections, withChildren) {
  return sections.map((section) => {
    const incompleteTodos = [...section.incompleteTodos];
    for (let start = 0; start < incompleteTodos.length; ) {
      const line = incompleteTodos[start];
      incompleteTodos[start] = setRolledCount(line, parseRolledCount(line) + 1);
      start = itemEnd(section, start, withChildren);
    }
    return { ...section, incompleteTodos };
  });
}

const LIST_PREFIX = /^(?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[.\]/;

export function itemLabel(item) {
  const text = stripRolledCount(item.lines[0]).replace(LIST_PREFIX, "").trim();
  const nested = item.lines.length - 1;
  return nested > 0 ? `${text} (+${nested} nested)` : text;
}

export function headingLabel(headingPath) {
  if (headingPath.length === 0) return "(no heading)";
  return headingPath.map((h) => h.replace(/^[#\s]+/, "").trim()).join(" › ");
}

export function summarizeDecisions(decisions) {
  const counts = { roll: 0, backlog: 0, cancel: 0, leave: 0 };
  for (const outcome of Object.values(decisions)) {
    if (outcome in counts) counts[outcome]++;
  }
  const parts = [
    [counts.roll, "roll"],
    [counts.backlog, "to backlog"],
    [counts.cancel, "cancelled"],
    [counts.leave, "left"],
  ]
    .filter(([n]) => n > 0)
    .map(([n, text]) => `${n} ${text}`);
  return parts.length > 0 ? parts.join(", ") : "nothing to do";
}
