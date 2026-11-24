// The Obsidian-free decision stage of rollover(), shared by index.js (through
// rollover-sources.js) and the unit flow test. index.js only reads and writes notes, shows the review
// dialog and the notices around these three steps:
//
// 1. planDecisions: before the dialog, the items and their default outcomes
// 2. applyPlan: the decisions turned into the sections to roll, the backlog
//    items and the line positions to change in the previous day's note
// 3. planInsert: once today's note is read, what actually goes into it

import { dedupeAgainstExisting, dropEmptyTodos } from "./insert-todos";
import {
  applyDecisions,
  bumpRolledCounts,
  countOutcomes,
  defaultDecisions,
  rebaseSections,
  skippedLinesToDelete,
  toItems,
} from "./rollover-items";
import { ruleResult } from "./rules";

/**
 * Groups the todos found in the previous day's note into review items and
 * picks each item's default outcome.
 *
 * @param {object} args
 * @param {object[]} args.sections - from getSections()
 * @param {string[]} [args.lines] - the lines the sections were parsed from;
 *   they tell which todo a skipped completed child sits under
 * @param {object} args.settings - removeEmptyTodos, rolloverChildren,
 *   trackRolloverCount, staleAfterRollovers, staleBehavior, backlogEnabled
 *   (whether a backlog note is set), cancelEnabled (whether Cancel is offered)
 *   and rules (the rule list; each item gets its ruleResult() as `rule`)
 * @param {string} [args.idPrefix] - put in front of every item id, so items
 *   from several source notes stay apart
 */
export function planDecisions({ sections, lines, settings, idPrefix = "" }) {
  const withChildren = settings.rolloverChildren;
  // positions of every todo line found, including empty ones that may not be
  // rolled over
  const foundLineIndices = sections.flatMap((s) => s.incompleteLineIndices);
  // completed children left behind by skipCompletedChildren
  const skippedLineIndices = [
    ...new Set(sections.flatMap((s) => s.skippedLineIndices ?? [])),
  ];

  let reviewSections = sections;
  let removedEmptyTodos = 0;
  if (settings.removeEmptyTodos) {
    const result = dropEmptyTodos(sections, { recordDropped: true });
    reviewSections = result.sections;
    removedEmptyTodos = result.removed;
  }

  const availability = {
    backlogEnabled: settings.backlogEnabled,
    cancelEnabled: settings.cancelEnabled,
  };
  const items = toItems(reviewSections, withChildren, idPrefix).map((item) => ({
    ...item,
    rule: ruleResult(
      item.lines[0],
      item.headingPath,
      settings.rules ?? [],
      availability
    ),
  }));
  const decisions = defaultDecisions(items, {
    trackRolloverCount: settings.trackRolloverCount,
    staleAfterRollovers: settings.staleAfterRollovers,
    staleBehavior: settings.staleBehavior,
    backlogEnabled: settings.backlogEnabled,
  });

  return {
    sections: reviewSections,
    lines,
    items,
    decisions,
    withChildren,
    foundLineIndices,
    skippedLineIndices,
    removedEmptyTodos,
  };
}

/**
 * Turns the decisions into what each note gets. Line positions refer to the
 * previous day's note as it was parsed.
 *
 * @param {object} args
 * @param {object} args.plan - from planDecisions()
 * @param {Record<string, string>} args.decisions - item id -> outcome
 * @param {boolean} [args.deleteOnlyChosen] - delete only the Roll and Backlog
 *   items and the dropped empty todos and skipped completed children that
 *   belong to them (the backlog: nothing the user did not choose goes)
 */
export function applyPlan({ plan, decisions, deleteOnlyChosen = false }) {
  const { sections, lines, items, foundLineIndices } = plan;
  const decided = applyDecisions({
    sections,
    items,
    decisions,
    foundLineIndices,
    lines,
  });
  return {
    // only Roll items go to today's note
    rolledSections: decided.sections,
    rolledTodoCount: decided.sections.flatMap((s) => s.incompleteTodos).length,
    backlogItems: decided.backlogItems,
    // Roll and Backlog items moved; Cancel and Leave items did not
    movedLineIndices: decided.movedLineIndices,
    cancelledLineIndices: decided.cancelledLineIndices,
    // delete also removes empty todos that were not rolled over, but never
    // Cancel or Leave items
    deleteLineIndices: deleteOnlyChosen
      ? decided.chosenLineIndices
      : decided.deleteLineIndices,
    skippedLineIndices: deleteOnlyChosen
      ? decided.skippedLineIndices
      : skippedLinesToDelete({
          skippedLineIndices: plan.skippedLineIndices,
          sections,
          items,
          decisions,
          lines,
        }),
    outcomeCounts: countOutcomes(items, decisions),
    // heads of the items whose counter a No stale count rule keeps as it is
    noStaleLineIndices: items
      .filter((item) => item.rule?.noStale)
      .map((item) => item.lineIndices[0]),
  };
}

/**
 * The sections to insert into today's note: the rolled sections without the
 * todos done in a newer note (handledLineIndices), without the todos today's
 * note already has (with skipExistingTodos), and with each item's counter
 * raised (with trackRolloverCount).
 *
 * @param {object} args
 * @param {object[]} args.sections - rolledSections from applyPlan()
 * @param {string} args.todayContent - today's note before anything is inserted
 * @param {object} args.settings - skipExistingTodos, rolloverChildren,
 *   trackRolloverCount, and doneStatusMarkers (the effective ones)
 * @param {number[]} [args.noStaleLineIndices] - from applyPlan(): items whose
 *   counter is not raised
 * @param {number[]} [args.handledLineIndices] - from applySources(): lines of
 *   items done in a newer note, dropped whatever skipExistingTodos is
 * @param {string[]} [args.lines] - the previous note's lines (plan.lines);
 *   with them, a todo whose parent does not come along starts at column 0
 *   (rebaseSections)
 * @returns {{ sections: object[], todosAlreadyPresent: number, duplicateTodos: string[], retainedLineIndices: number[], todosDoneElsewhere: number }}
 *   `retainedLineIndices` holds the lines of skip-existing duplicates and of
 *   handled todos; `todosDoneElsewhere` counts the handled lines dropped
 */
export function planInsert({
  sections,
  todayContent,
  settings,
  noStaleLineIndices = [],
  handledLineIndices = [],
  lines,
}) {
  let todosAlreadyPresent = 0;
  let todosDoneElsewhere = 0;
  const duplicateTodos = [];
  // lines of duplicates dropped by skip-existing and of todos done in a newer
  // note: they did not move
  const retainedLineIndices = [];

  let toInsert = sections;
  if (handledLineIndices.length > 0) {
    const handled = new Set(handledLineIndices);
    toInsert = toInsert
      .map((section) => {
        const kept = section.incompleteLineIndices.map(
          (index) => !handled.has(index)
        );
        const dropped = section.incompleteLineIndices.filter(
          (_, i) => !kept[i]
        );
        todosDoneElsewhere += dropped.length;
        retainedLineIndices.push(...dropped);
        // positions kept in step with the todos, as skip-existing does below
        return {
          ...section,
          incompleteTodos: section.incompleteTodos.filter((_, i) => kept[i]),
          incompleteLineIndices: section.incompleteLineIndices.filter(
            (_, i) => kept[i]
          ),
        };
      })
      .filter((section) => section.incompleteTodos.length > 0);
  }
  if (settings.skipExistingTodos) {
    toInsert = toInsert
      .map((section) => {
        const { todos, skipped, duplicates, droppedIndices } =
          dedupeAgainstExisting(
            section.incompleteTodos,
            todayContent,
            settings.rolloverChildren,
            settings.doneStatusMarkers
          );
        todosAlreadyPresent += skipped;
        duplicateTodos.push(...duplicates);
        retainedLineIndices.push(
          ...droppedIndices.map((i) => section.incompleteLineIndices[i])
        );
        // keep the line positions in step with the kept todos, so the
        // counters below find the same items as the review; the previous
        // day's note uses retainedLineIndices, not these
        const dropped = new Set(droppedIndices);
        return {
          ...section,
          incompleteTodos: todos,
          incompleteLineIndices: section.incompleteLineIndices.filter(
            (_, i) => !dropped.has(i)
          ),
        };
      })
      .filter((section) => section.incompleteTodos.length > 0);
  }
  // count this rollover on each item that is actually inserted
  if (settings.trackRolloverCount) {
    toInsert = bumpRolledCounts(toInsert, settings.rolloverChildren, {
      skipHeadLineIndices: new Set(noStaleLineIndices),
    });
  }

  // last, so the counters above group items by the note's own indentation
  if (lines) toInsert = rebaseSections(toInsert, lines);

  return {
    sections: toInsert,
    todosAlreadyPresent,
    duplicateTodos,
    retainedLineIndices,
    todosDoneElsewhere,
  };
}
