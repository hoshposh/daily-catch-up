// The Obsidian-free decision stage of rollover(), shared by index.js and the
// end-to-end tests. index.js only reads and writes notes, shows the review
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
  skippedLinesToDelete,
  toItems,
} from "./rollover-items";

/**
 * Groups the todos found in the previous day's note into review items and
 * picks each item's default outcome.
 *
 * @param {object} args
 * @param {object[]} args.sections - from getSections()
 * @param {string[]} [args.lines] - the lines the sections were parsed from;
 *   they tell which todo a skipped completed child sits under
 * @param {object} args.settings - removeEmptyTodos, rolloverChildren,
 *   trackRolloverCount, staleAfterRollovers, staleBehavior and backlogEnabled
 *   (whether a backlog note is set)
 */
export function planDecisions({ sections, lines, settings }) {
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

  const items = toItems(reviewSections, withChildren);
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
 */
export function applyPlan({ plan, decisions }) {
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
    deleteLineIndices: decided.deleteLineIndices,
    skippedLineIndices: skippedLinesToDelete({
      skippedLineIndices: plan.skippedLineIndices,
      sections,
      items,
      decisions,
      lines,
    }),
    outcomeCounts: countOutcomes(items, decisions),
  };
}

/**
 * The sections to insert into today's note: the rolled sections without the
 * todos today's note already has (with skipExistingTodos), and with each
 * item's counter raised (with trackRolloverCount).
 *
 * @param {object} args
 * @param {object[]} args.sections - rolledSections from applyPlan()
 * @param {string} args.todayContent - today's note before anything is inserted
 * @param {object} args.settings - skipExistingTodos, rolloverChildren,
 *   trackRolloverCount, and doneStatusMarkers (the effective ones)
 */
export function planInsert({ sections, todayContent, settings }) {
  let todosAlreadyPresent = 0;
  const duplicateTodos = [];
  // lines of duplicates dropped by skip-existing: they did not move
  const retainedLineIndices = [];

  let toInsert = sections;
  if (settings.skipExistingTodos) {
    toInsert = sections
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
    toInsert = bumpRolledCounts(toInsert, settings.rolloverChildren);
  }

  return {
    sections: toInsert,
    todosAlreadyPresent,
    duplicateTodos,
    retainedLineIndices,
  };
}
