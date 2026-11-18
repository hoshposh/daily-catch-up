// The Obsidian-free orchestration of a rollover over several source notes,
// shared by index.js and the end-to-end tests. It loops the steps of
// rollover-plan.js over a list of sources (the previous day's note, and later
// others). A source is `{ key, kind, name, lines, sections, sourceAction }`;
// `key` is put in front of its item ids ("" for the previous day's note, so
// its ids stay as they were) and `name` is what its backlog items say they
// came from.
//
// 1. planSources: every source's items and default outcomes
// 2. applySources: the decisions turned into what each source and the backlog
//    get
// 3. insertSources: the rolled sections of every source put into today's
//    note, one source after the other

import { insertSections } from "./insert-sections";
import { applyPlan, planDecisions, planInsert } from "./rollover-plan";

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
