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

// End (exclusive) of the item that starts at `start` in `section`: the head
// plus the following lines that are its nested lines. A following line extends
// the item only if it is indented deeper than the head and nothing but skipped
// completed children lies between it and the line before, in the note. Any
// other open todo (under a done parent or a plain bullet) is its own item.
// Without children, one line.
function itemEnd(section, start, withChildren) {
  if (!withChildren) return start + 1;
  const todos = section.incompleteTodos;
  const indices = section.incompleteLineIndices;
  const skipped = new Set(section.skippedLineIndices ?? []);
  const headIndentation = indentationOf(todos[start]);
  let end = start + 1;
  while (end < todos.length && indentationOf(todos[end]) > headIndentation) {
    for (let i = indices[end - 1] + 1; i < indices[end]; i++) {
      if (!skipped.has(i)) return end;
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

// The item a skipped line belongs to: the one in its section whose head line
// index is the largest one below it, or null when there is none
function ownerOf(items, sectionIndex, line) {
  let owner = null;
  for (const item of items) {
    if (item.sectionIndex !== sectionIndex) continue;
    const head = item.lineIndices[0];
    if (head < line && (owner === null || head > owner.lineIndices[0])) {
      owner = item;
    }
  }
  return owner;
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

export function applyDecisions({
  sections,
  items,
  decisions,
  foundLineIndices,
}) {
  const outcomes = items.map((item) => outcomeOf(decisions, item));
  const keptItems = items.filter((_, i) => outcomes[i] === "roll");
  const backlogItems = items.filter((_, i) => outcomes[i] === "backlog");
  const cancelled = items.filter((_, i) => outcomes[i] === "cancel");
  const left = items.filter(
    (_, i) => !["roll", "backlog", "cancel"].includes(outcomes[i])
  );

  const movedLineIndices = items
    .filter((_, i) => outcomes[i] === "roll" || outcomes[i] === "backlog")
    .flatMap((item) => item.lineIndices);
  const cancelledLineIndices = cancelled.flatMap((item) => item.lineIndices);
  const kept = new Set([
    ...cancelledLineIndices,
    ...left.flatMap((item) => item.lineIndices),
  ]);
  const deleteLineIndices = foundLineIndices.filter((i) => !kept.has(i));

  // A skipped line belongs to the item in its section whose head line index is
  // the largest one below it; it is kept only for Roll and Backlog items.
  const movedItemIds = new Set(
    items
      .filter((_, i) => outcomes[i] === "roll" || outcomes[i] === "backlog")
      .map((item) => item.id)
  );
  const skippedKept = (sectionIndex) =>
    (sections[sectionIndex].skippedLineIndices ?? []).filter((line) => {
      const owner = ownerOf(items, sectionIndex, line);
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
 * @returns {number[]}
 */
export function skippedLinesToDelete({
  skippedLineIndices,
  sections,
  items,
  decisions,
}) {
  const held = new Set();
  sections.forEach((section, sectionIndex) => {
    for (const line of section.skippedLineIndices ?? []) {
      const owner = ownerOf(items, sectionIndex, line);
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
