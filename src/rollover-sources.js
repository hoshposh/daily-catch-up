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
 * A source's `key` is put in front of its item ids, which are
 * `{section}:{line}`. It must be "" or end in a non-digit separator such as
 * "/" ("inbox/"): a key ending in a digit could make two sources' ids equal
 * ("1" + "0:0" and "" + "10:0"). The decisions of all sources share one map,
 * so a duplicate id throws instead of one item silently taking another's
 * outcome.
 *
 * @param {object} args
 * @param {object[]} args.sources
 * @param {object} args.settings - what planDecisions() takes
 * @returns {{ plans: object[], items: object[], decisions: Record<string, string> }}
 *   `plans[i]` belongs to `sources[i]`; `items` and `decisions` cover all of them
 * @throws {Error} when two items, of the same or different sources, share an id
 */
export function planSources({ sources, settings }) {
  const plans = sources.map((source) => {
    const plan = planDecisions({
      sections: source.sections,
      lines: source.lines,
      settings,
      idPrefix: source.key ?? "",
    });
    if (typeof source.placement !== "string") return plan;
    // a source with a placement sends its items there, unless a Move to
    // heading rule already sends them somewhere
    return {
      ...plan,
      items: plan.items.map((item) =>
        item.rule?.moveTo
          ? item
          : { ...item, rule: { ...item.rule, moveTo: source.placement } }
      ),
    };
  });
  const items = plans.flatMap((plan) => plan.items);
  const seen = new Set();
  for (const { id } of items) {
    if (seen.has(id)) {
      throw new Error(`planSources: duplicate item id "${id}"`);
    }
    seen.add(id);
  }
  return {
    plans,
    items,
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
  const perSource = plans.map((plan, i) => {
    const applied = applyPlan({ plan, decisions });
    // a source that does not count keeps every item's counter as it is
    if (sources[i].countRollover === false) {
      applied.noStaleLineIndices = plan.items.map(
        (item) => item.lineIndices[0]
      );
    }
    return applied;
  });
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
    keepHeadings: source.keepHeadings ?? false,
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
 * @param {{ kind?: string, name: string, sourceAction: string, removedEmptyTodos: number, leftCount: number, rolledCount?: number }[]} args.sources
 *   `rolledCount` is the todos of that source actually inserted; the rolled
 *   line names every source that is not the previous day's note and
 *   contributed some
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
    const fromInboxes = sources
      .filter(({ kind, rolledCount }) => kind !== "previous" && rolledCount > 0)
      .map(({ name, rolledCount }) => `${rolledCount} from ${name}`);
    const parts = fromInboxes.length > 0 ? ` (${fromInboxes.join(", ")})` : "";
    lines.push(
      `- ${todosAdded} todo${plural(todosAdded)} rolled over${parts}. `
    );
  }
  // empty todos are only removed from a source that deletes
  const removedEmptyTodos = sources
    .filter(({ sourceAction }) => sourceAction === "delete")
    .reduce((sum, source) => sum + (source.removedEmptyTodos ?? 0), 0);
  if (removedEmptyTodos > 0) {
    lines.push(
      `- ${removedEmptyTodos} empty todo${plural(removedEmptyTodos)} removed. `
    );
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

/**
 * How a notice names a source: "the previous day's note" or "the inbox note
 * 'Inbox'".
 *
 * @param {{ kind: string, name: string }} source
 */
export function sourceLabel(source) {
  return source.kind === "inbox"
    ? `the inbox note '${source.name}'`
    : "the previous day's note";
}

const labelsOf = (sources) => sources.map(sourceLabel).join(" and ");

/**
 * The notice for a source note that was edited while the rollover was
 * running, so it was left unchanged.
 *
 * @param {{ kind: string, name: string }} source
 */
export function sourceUnchangedNotice(source) {
  if (source.kind === "inbox") {
    return `Rollover left ${sourceLabel(
      source
    )} unchanged: it was edited while the rollover was running. Its todos were still added to today's note; remove them from the inbox yourself.`;
  }
  return "Rollover left the previous day's note unchanged: it was edited while the rollover was running.";
}

/**
 * The notice when the Templater safeguard found today's note changed by
 * another plugin, so the source notes were left unchanged.
 *
 * @param {{ kind: string, name: string }[]} sources
 */
export function templaterNotice(sources) {
  return `Rollover left ${labelsOf(
    sources
  )} unchanged: today's note was modified by another plugin (likely Templater) after the todos were added, and they may be missing. Run 'Roll over todos now' to try again.`;
}

/**
 * The notice when the backlog note could not be written, so the source notes
 * were left unchanged.
 *
 * @param {object} args
 * @param {string} args.backlogPath
 * @param {Error|string} args.error
 * @param {number} args.todosAdded - rolled todos, all sources
 * @param {{ kind: string, name: string }[]} args.sources
 */
export function backlogFailedNotice({
  backlogPath,
  error,
  todosAdded,
  sources,
}) {
  const todaysPart =
    todosAdded > 0
      ? ` ${todosAdded} todo${
          todosAdded > 1 ? "s were" : " was"
        } rolled over to today's note.`
      : "";
  return `Rollover couldn't write the backlog note '${backlogPath}' (${
    error?.message ?? error
  }), so ${labelsOf(sources)} ${
    sources.length > 1 ? "were" : "was"
  } left unchanged.${todaysPart}`;
}

/**
 * The notice when a source note could not be written; its todos were still
 * added to today's note.
 *
 * @param {{ kind: string, name: string }} source
 * @param {Error|string} error
 */
export function sourceWriteFailedNotice(source, error) {
  return `Rollover couldn't write ${sourceLabel(source)} (${
    error?.message ?? error
  }), so it was left unchanged. Its todos were still added to today's note.`;
}
