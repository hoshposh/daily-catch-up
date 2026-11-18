// The Obsidian-free orchestration of a rollover over several source notes,
// shared by index.js and the unit flow test (src/rollover-flow.test.js). It
// loops the steps of rollover-plan.js over a list of sources (the previous
// day's note, and later others). A source is
// `{ key, kind, name, lines, sections, sourceAction }`; `key` is put in front
// of its item ids ("" for the previous day's note, so its ids stay as they
// were) and `name` is what its backlog items say they came from.
//
// 1. planSources: every source's items and default outcomes
// 2. applySources: the decisions turned into what each source and the backlog
//    get
// 3. insertSources: the rolled sections of every source put into today's
//    note, one source after the other
// 4. writeSource: what one source note becomes (Cancel marks, then its
//    source action), once today's note and the backlog are written

import { insertSections } from "./insert-sections";
import { applyPlan, planDecisions, planInsert } from "./rollover-plan";
import {
  applySourceAction,
  effectiveDoneStatusMarkers,
  markCancelled,
  normalizeMarker,
} from "./source-action";

const OUTCOMES = ["roll", "backlog", "cancel", "leave"];

/**
 * Plans every source and joins their items and default decisions.
 *
 * @param {object} args
 * @param {object[]} args.sources
 * @param {object} args.settings - what planDecisions() takes
 * @returns {{ plans: object[], items: object[], decisions: Record<string, string> }}
 *   `plans[i]` belongs to `sources[i]`; `items` and `decisions` cover all of them
 */
export function planSources({ sources, settings }) {
  const plans = sources.map((source) =>
    planDecisions({
      sections: source.sections,
      lines: source.lines,
      settings,
      idPrefix: source.key ?? "",
    })
  );
  return {
    plans,
    items: plans.flatMap((plan) => plan.items),
    decisions: Object.assign({}, ...plans.map((plan) => plan.decisions)),
  };
}

/**
 * Turns the decisions into what each source gets (applyPlan()), the backlog
 * items of all sources, and the outcome counts added up.
 *
 * @param {object} args
 * @param {object[]} args.plans - from planSources()
 * @param {object[]} args.sources - the sources the plans were made for
 * @param {Record<string, string>} args.decisions - item id -> outcome
 * @returns {{ perSource: object[], backlogItems: object[], outcomeCounts: Record<string, number> }}
 */
export function applySources({ plans, sources, decisions }) {
  const perSource = plans.map((plan) => applyPlan({ plan, decisions }));
  const backlogItems = perSource.flatMap((applied, i) =>
    applied.backlogItems.map((item) => ({
      ...item,
      sourceName: sources[i].name,
    }))
  );
  const outcomeCounts = Object.fromEntries(
    OUTCOMES.map((outcome) => [
      outcome,
      perSource.reduce(
        (sum, applied) => sum + applied.outcomeCounts[outcome],
        0
      ),
    ])
  );
  return { perSource, backlogItems, outcomeCounts };
}

/**
 * Inserts the rolled sections of every source into today's note, in order.
 * Each source is planned against the content the sources before it left, so
 * with skipExistingTodos a todo that an earlier source inserted is not added
 * again.
 *
 * @param {object} args
 * @param {string} args.content - today's note
 * @param {{ sections: object[], lines: string[], noStaleLineIndices?: number[] }[]} args.entries
 *   one per source: its rolledSections, its lines and its noStaleLineIndices
 * @param {object} args.settings - skipExistingTodos, rolloverChildren,
 *   trackRolloverCount, doneStatusMarkers (the effective ones), templateHeading
 *   and leadingNewLine
 * @returns {{ content: string, templateHeadingNotFound: boolean, perSource: object[] }}
 *   `perSource[i]` is { todosAlreadyPresent, duplicateTodos,
 *   retainedLineIndices, insertedTodos } for `entries[i]`
 */
export function insertSources({ content, entries, settings }) {
  let current = content;
  let templateHeadingNotFound = false;
  const perSource = entries.map((entry) => {
    if (entry.sections.length === 0) {
      return {
        todosAlreadyPresent: 0,
        duplicateTodos: [],
        retainedLineIndices: [],
        insertedTodos: [],
      };
    }
    const planned = planInsert({
      sections: entry.sections,
      todayContent: current,
      settings,
      noStaleLineIndices: entry.noStaleLineIndices,
      lines: entry.lines,
    });
    // nothing left after skip-existing: leave the note exactly as it is
    // (insertSections() would normalise its line endings)
    if (planned.sections.length > 0) {
      const inserted = insertSections({
        content: current,
        sections: planned.sections,
        templateHeading: settings.templateHeading,
        leadingNewLine: settings.leadingNewLine,
      });
      current = inserted.content;
      if (inserted.templateHeadingNotFound) templateHeadingNotFound = true;
    }
    return {
      todosAlreadyPresent: planned.todosAlreadyPresent,
      duplicateTodos: planned.duplicateTodos,
      retainedLineIndices: planned.retainedLineIndices,
      insertedTodos: planned.sections.flatMap((s) => s.incompleteTodos),
    };
  });
  return { content: current, templateHeadingNotFound, perSource };
}

/**
 * What one source note becomes after the rollover: its Cancel items marked
 * first, then the source's action ("delete" | "mark") on its Roll and Backlog
 * items. Leave items are untouched. Line positions refer to the note as it
 * was parsed, so `content` must be exactly that note (index.js checks that it
 * was not edited meanwhile before calling this).
 *
 * @param {object} args
 * @param {string} args.content - the source note as it was parsed
 * @param {{ sourceAction: "none"|"delete"|"mark" }} args.source
 * @param {object} args.decided - the source's entry in applySources().perSource
 *   (cancelledLineIndices, movedLineIndices, deleteLineIndices,
 *   skippedLineIndices)
 * @param {number[]} [args.retainedLineIndices] - the source's
 *   insertSources().perSource[i].retainedLineIndices: duplicates skip existing
 *   kept out of today's note, which "mark" with moveNested must not remove
 * @param {object} args.settings - the plugin settings: cancelMarker,
 *   rolloverSourceMarker, doneStatusMarkers, onRolloverSourceAction (with the
 *   two before it, for effectiveDoneStatusMarkers()), ignoreBlockquotes,
 *   moveNestedItemsOnMark and rolloverChildren
 * @returns {{ content: string, changed: boolean }} the new content, and
 *   whether it differs from `content`
 */
export function writeSource({
  content,
  source,
  decided,
  retainedLineIndices = [],
  settings,
}) {
  // Cancel only rewrites checkboxes, so the positions stay valid for the
  // source action below
  const cancelled = markCancelled({
    content,
    lineIndices: decided.cancelledLineIndices,
    marker: normalizeMarker(settings.cancelMarker, "-"),
    doneStatusMarkers: effectiveDoneStatusMarkers(settings),
    ignoreBlockquotes: settings.ignoreBlockquotes,
  }).content;
  if (source.sourceAction === "none") {
    return { content: cancelled, changed: cancelled !== content };
  }
  const result = applySourceAction({
    content: cancelled,
    action: source.sourceAction,
    // Roll and Backlog items moved; Cancel and Leave items did not
    rolledLineIndices: decided.movedLineIndices,
    // delete also removes empty todos that were not rolled over, but never
    // Cancel or Leave items
    deletedLineIndices: decided.deleteLineIndices,
    skippedLineIndices: decided.skippedLineIndices,
    marker: normalizeMarker(settings.rolloverSourceMarker),
    // the raw setting, as it has always been passed here
    doneStatusMarkers: settings.doneStatusMarkers,
    ignoreBlockquotes: settings.ignoreBlockquotes,
    // nested items only moved when children were rolled over
    moveNested: settings.moveNestedItemsOnMark && settings.rolloverChildren,
    retainLineIndices: retainedLineIndices,
  });
  return { content: result.content, changed: result.content !== content };
}

const plural = (count) => (count > 1 ? "s" : "");

/**
 * The notice shown after a rollover: one line per thing that happened, blank
 * ones left out. The rolled and empty-todo lines end in a space, as they
 * always have.
 *
 * @param {object} args
 * @param {boolean} args.templateHeadingNotFound
 * @param {string} args.templateHeading
 * @param {number} args.todosAdded - rolled todos, all sources
 * @param {number} args.todosAlreadyPresent - lines skipped, all sources
 * @param {number} args.backlogCount
 * @param {string} args.backlogPath
 * @param {number} args.cancelledCount - 0 when the cancel marks were not applied
 * @param {{ name: string, sourceAction: string, removedEmptyTodos: number, leftCount: number }[]} args.sources
 * @returns {string} "" when there is nothing to say
 */
export function rolloverNotice({
  templateHeadingNotFound,
  templateHeading,
  todosAdded,
  todosAlreadyPresent,
  backlogCount,
  backlogPath,
  cancelledCount,
  sources,
}) {
  const lines = [];
  if (templateHeadingNotFound) {
    lines.push(
      `Rollover couldn't find '${templateHeading}' in today's daily note. Rolling todos to end of file.`
    );
  }
  if (todosAdded > 0) {
    lines.push(`- ${todosAdded} todo${plural(todosAdded)} rolled over. `);
  }
  for (const { sourceAction, removedEmptyTodos } of sources) {
    if (removedEmptyTodos > 0 && sourceAction === "delete") {
      lines.push(
        `- ${removedEmptyTodos} empty todo${plural(
          removedEmptyTodos
        )} removed. `
      );
    }
  }
  if (todosAlreadyPresent > 0) {
    lines.push(
      `- ${todosAlreadyPresent} line${plural(
        todosAlreadyPresent
      )} skipped (already in today's note).`
    );
  }
  if (backlogCount > 0) {
    lines.push(`- ${backlogCount} moved to backlog (${backlogPath}).`);
  }
  if (cancelledCount > 0) {
    lines.push(`- ${cancelledCount} cancelled.`);
  }
  for (const { name, leftCount } of sources) {
    if (leftCount > 0) lines.push(`- ${leftCount} left in ${name}.`);
  }
  return lines.join("\n");
}
