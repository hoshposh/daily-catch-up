// The Obsidian-free orchestration of a rollover over several source notes,
// shared by index.js and the unit flow test (src/rollover-flow.test.js). It
// loops the steps of rollover-plan.js over a list of sources, in this order:
// the previous day's note (kind "previous"), the older daily notes Look back
// reads, newest first (kind "earlier"), and the inbox note (kind "inbox"). A
// source is `{ key, kind, name, lines, sections, sourceAction }`; `key` is put
// in front of its item ids ("" for the previous day's note, so its ids stay as
// they were) and `name` is what its backlog items say they came from. An
// earlier source also carries `newerDoneKeys`, the todos done in a note newer
// than it: its items done there are handled (hidden from the review, rolled so
// its action marks or deletes them, but kept out of today's note), and its
// items a rule leaves are hidden from the review too.
//
// 1. planSources: every source's items and default outcomes
// 2. applySources: the decisions turned into what each source and the backlog
//    get
// 3. insertSources: the rolled sections of every source put into today's
//    note, one source after the other
// 4. writeSource: what one source note becomes (Cancel marks, then its
//    source action), once today's note and the backlog are written

import { normalizeHeading } from "./backlog";
import { insertSections } from "./insert-sections";
import { cumulativeDoneKeys, handledItemIds } from "./look-back";
import { applyPlan, planDecisions, planInsert } from "./rollover-plan";
import {
  applySourceAction,
  effectiveDoneStatusMarkers,
  inboxSourceAction,
  markCancelled,
  normalizeMarker,
  resolveSourceAction,
} from "./source-action";

const OUTCOMES = ["roll", "backlog", "cancel", "leave"];

// re-exported: index.js and the tests take it from here with the other
// source helpers
export { inboxSourceAction };

/**
 * The inbox note as a source, after the previous day's note. Delete keeps its
 * headings (QuickAdd's Insert after needs them), its todos' counters are not
 * raised, and with an inbox heading its items are moved under that heading.
 *
 * @param {object} args
 * @param {{ basename: string }} args.file - the inbox note
 * @param {string} args.content - as read
 * @param {string[]} args.lines - splitLines(content)
 * @param {object[]} args.sections - getSections() of `lines`, with the same
 *   options as the previous note
 * @param {object} args.settings - inboxSourceAction and inboxHeading
 */
export function inboxSource({ file, content, lines, sections, settings }) {
  const heading = settings.inboxHeading ?? "";
  return {
    key: "inbox/",
    kind: "inbox",
    name: file.basename,
    file,
    content,
    lines,
    sections,
    sourceAction: inboxSourceAction(settings),
    keepHeadings: true,
    countRollover: false,
    placement: heading.trim() ? normalizeHeading(heading) : null,
  };
}

/**
 * An older daily note read by Look back as a source, between the previous
 * day's note and the inbox. It behaves as the previous note does (its action,
 * counters raised, delete removes emptied headings), except that its items
 * done in a newer note are handled and its rule-chosen Leaves are hidden
 * (planSources()).
 *
 * @param {object} args
 * @param {{ path: string, basename: string }} args.file - the older note; its
 *   path makes the key, so two notes with the same name stay apart
 * @param {string} args.content - as read
 * @param {string[]} args.lines - splitLines(content)
 * @param {object[]} args.sections - getSections() of `lines`, with the same
 *   options as the previous note
 * @param {object} args.settings - onRolloverSourceAction
 * @param {Set<string>} args.newerDoneKeys - the done todo keys of every note
 *   newer than this one (cumulativeDoneKeys())
 */
export function earlierSource({
  file,
  content,
  lines,
  sections,
  settings,
  newerDoneKeys,
}) {
  return {
    key: file.path + "/",
    kind: "earlier",
    name: file.basename,
    file,
    content,
    lines,
    sections,
    sourceAction: resolveSourceAction(settings),
    newerDoneKeys,
  };
}

/**
 * The sources of the older daily notes Look back reads, in the order given
 * (newest first). Each one's `newerDoneKeys` are the todos done in today's
 * note, the previous note or an older note listed before it.
 *
 * @param {object} args
 * @param {string[]} args.todayLines - today's note, as read before the review
 * @param {string[]} args.previousLines - the previous daily note ([] without
 *   one)
 * @param {{ file: { path: string, basename: string }, content: string, lines: string[], sections: object[] }[]} args.notes
 *   the older notes, newest first, as earlierSource() takes them
 * @param {object} args.settings - what earlierSource() takes
 * @param {string} args.doneStatusMarkers - the effective ones
 *   (effectiveDoneStatusMarkers())
 * @returns {object[]} one earlierSource() per note, in the same order
 */
export function earlierSources({
  todayLines,
  previousLines,
  notes,
  settings,
  doneStatusMarkers,
}) {
  // entry k + 2 holds what is done in every note newer than notes[k]
  const newerDoneKeys = cumulativeDoneKeys(
    [todayLines, previousLines, ...notes.map((note) => note.lines)],
    doneStatusMarkers
  );
  return notes.map((note, k) =>
    earlierSource({ ...note, settings, newerDoneKeys: newerDoneKeys[k + 2] })
  );
}

/**
 * An earlier source's items, marked: `hidden` when a rule leaves them (they
 * stay Leave and are never touched, even when done in a newer note), else
 * `handled` and `hidden` when done in a newer note (their decision becomes
 * "roll"). Handled wins over a rule's Backlog or Cancel, never over its Leave.
 */
function markEarlierItems(plan, source, doneStatusMarkers) {
  const handled = handledItemIds(
    plan.items,
    source.newerDoneKeys ?? new Set(),
    doneStatusMarkers
  );
  const decisions = { ...plan.decisions };
  const items = plan.items.map((item) => {
    // a rule-chosen Leave stays put, as it does every day the rule matches
    if (item.rule?.outcome === "leave") return { ...item, hidden: true };
    if (handled.has(item.id)) {
      // rolled, so the source action marks or deletes it; planInsert() keeps
      // it out of today's note
      decisions[item.id] = "roll";
      return { ...item, handled: true, hidden: true };
    }
    return item;
  });
  return { ...plan, items, decisions };
}

export const INBOX_GUARD_NOTICE =
  "The inbox note can't be today's note, the previous daily note or the backlog note. Change it in settings.";

const INBOX_GUARD_EARLIER_NOTICE =
  "The inbox note can't be today's note, a daily note the rollover reads or the backlog note. Change it in settings.";

export const BACKLOG_GUARD_NOTICE =
  "The backlog note can't be today's or the previous daily note. Change it in settings.";

export const BACKLOG_GUARD_EARLIER_NOTICE =
  "The backlog note can't be today's note or a daily note the rollover reads. Change it in settings.";

/**
 * Whether the inbox note is a note it must never be: today's note, the
 * previous daily note, an older daily note the rollover reads, or the backlog
 * note. A missing previous note or backlog note (null or undefined) is not
 * compared.
 *
 * @param {object} args
 * @param {string} args.inboxPath
 * @param {string} args.todayPath
 * @param {string} [args.previousPath]
 * @param {string|null} [args.backlogPath]
 * @param {string[]} [args.earlierPaths] - paths of the older daily notes read
 */
export function inboxPathConflicts({
  inboxPath,
  todayPath,
  previousPath,
  backlogPath,
  earlierPaths = [],
}) {
  return [todayPath, previousPath, backlogPath, ...earlierPaths].some(
    (path) => path != null && path === inboxPath
  );
}

/**
 * The notice for an inbox note that conflicts (see `inboxPathConflicts()`,
 * which must have returned true): the one naming older daily notes when the
 * inbox is one of them, else `INBOX_GUARD_NOTICE`.
 *
 * @param {object} args
 * @param {string} args.inboxPath
 * @param {string[]} [args.earlierPaths]
 */
export function inboxGuardNotice({ inboxPath, earlierPaths = [] }) {
  return earlierPaths.includes(inboxPath)
    ? INBOX_GUARD_EARLIER_NOTICE
    : INBOX_GUARD_NOTICE;
}

/**
 * The notice to show when the backlog note is a note it must never be, or
 * `null` when it is fine (also when there is no backlog note): today's note or
 * the previous daily note gives `BACKLOG_GUARD_NOTICE`, an older daily note
 * the rollover reads gives `BACKLOG_GUARD_EARLIER_NOTICE`.
 *
 * @param {object} args
 * @param {string|null} [args.backlogPath]
 * @param {string} args.todayPath
 * @param {string} [args.previousPath]
 * @param {string[]} [args.earlierPaths]
 * @returns {string|null}
 */
export function backlogPathConflict({
  backlogPath,
  todayPath,
  previousPath,
  earlierPaths = [],
}) {
  if (!backlogPath) return null;
  if (backlogPath === todayPath || backlogPath === previousPath) {
    return BACKLOG_GUARD_NOTICE;
  }
  return earlierPaths.includes(backlogPath)
    ? BACKLOG_GUARD_EARLIER_NOTICE
    : null;
}

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
 * Items of an earlier source whose rule outcome is Leave get `hidden: true`
 * and stay Leave; its other items done in a newer note get `handled: true,
 * hidden: true` and the decision "roll", whatever a rule's Backlog or Cancel
 * says. Hidden items are kept out of `reviewItems`. Other sources' items are
 * not marked.
 *
 * @param {object} args
 * @param {object[]} args.sources
 * @param {object} args.settings - what planDecisions() takes, and
 *   doneStatusMarkers (the effective ones) for earlier sources
 * @returns {{ plans: object[], items: object[], reviewItems: object[], decisions: Record<string, string> }}
 *   `plans[i]` belongs to `sources[i]`; `items` and `decisions` cover all of
 *   them, `reviewItems` the items the review shows (none hidden)
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
    if (source.kind === "earlier") {
      return markEarlierItems(plan, source, settings.doneStatusMarkers ?? "");
    }
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
    reviewItems: items.filter((item) => !item.hidden),
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
 *   `perSource[i]` is applyPlan()'s result for `sources[i]`, plus
 *   `handledLineIndices` (every line of its handled items, for
 *   insertSources()), `handledCount` (its handled items) and `leftCount` (its
 *   items decided "leave" that the review showed)
 */
export function applySources({ plans, sources, decisions }) {
  const perSource = plans.map((plan, i) => {
    const handled = plan.items.filter((item) => item.handled);
    const applied = {
      ...applyPlan({ plan, decisions }),
      handledLineIndices: handled.flatMap((item) => item.lineIndices),
      handledCount: handled.length,
      leftCount: plan.items.filter(
        (item) => !item.hidden && decisions[item.id] === "leave"
      ).length,
    };
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
 * @param {{ sections: object[], lines: string[], noStaleLineIndices?: number[], handledLineIndices?: number[] }[]} args.entries
 *   one per source: its rolledSections, its lines, its noStaleLineIndices and
 *   its handledLineIndices (todos done in a newer note, kept out)
 * @param {object} args.settings - skipExistingTodos, rolloverChildren,
 *   trackRolloverCount, doneStatusMarkers (the effective ones), templateHeading
 *   and leadingNewLine
 * @returns {{ content: string, templateHeadingNotFound: boolean, perSource: object[] }}
 *   `perSource[i]` is { todosAlreadyPresent, duplicateTodos,
 *   retainedLineIndices, insertedTodos, todosDoneElsewhere } for `entries[i]`
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
        todosDoneElsewhere: 0,
      };
    }
    const planned = planInsert({
      sections: entry.sections,
      todayContent: current,
      settings,
      noStaleLineIndices: entry.noStaleLineIndices,
      handledLineIndices: entry.handledLineIndices,
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
      todosDoneElsewhere: planned.todosDoneElsewhere,
    };
  });
  return { content: current, templateHeadingNotFound, perSource };
}

/**
 * Whether a source note has to go through writeSource() at all. A source that
 * leaves its todos alone ("none") is only written for its Cancel marks. An
 * older daily note is only written when it has lines to mark, cancel or
 * delete: one holding nothing but Leave items (a rule's, hidden from the
 * review, or the user's) is not opened for writing. The previous note and the
 * inbox are written as they always were.
 *
 * @param {{ kind: string, sourceAction: string }} source
 * @param {object} decided - the source's entry in applySources().perSource
 */
export function sourceNeedsWrite(source, decided) {
  if (source.sourceAction === "none") {
    return decided.cancelledLineIndices.length > 0;
  }
  if (source.kind !== "earlier") return true;
  return [
    decided.movedLineIndices,
    decided.cancelledLineIndices,
    decided.deleteLineIndices,
    decided.skippedLineIndices,
  ].some((indices) => indices.length > 0);
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
 *   and todos done in a newer note kept out of today's note, which "mark"
 *   with moveNested must not remove
 * @param {object} args.settings - the plugin settings: cancelMarker,
 *   rolloverSourceMarker, doneStatusMarkers, onRolloverSourceAction,
 *   inboxNotePath and inboxSourceAction (with the two before them, for
 *   effectiveDoneStatusMarkers()), ignoreBlockquotes,
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
 * @param {number} [args.doneElsewhereCount] - items of older notes already
 *   done in a newer note
 * @param {number} args.backlogCount
 * @param {string} args.backlogPath
 * @param {number} args.cancelledCount - 0 when the cancel marks were not applied
 * @param {{ kind?: string, name: string, sourceAction: string, removedEmptyTodos: number, leftCount: number, rolledCount?: number }[]} args.sources
 *   `rolledCount` is the todos of that source actually inserted; when more
 *   than one source contributed, the rolled line names the sources that are
 *   not the previous day's note and contributed some: the older notes
 *   (`kind: "earlier"`) summed into one part, then the inbox
 * @returns {string} "" when there is nothing to say
 */
export function rolloverNotice({
  templateHeadingNotFound,
  templateHeading,
  todosAdded,
  todosAlreadyPresent,
  doneElsewhereCount = 0,
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
    const contributors = sources.filter(({ rolledCount }) => rolledCount > 0);
    const fromEarlier = contributors
      .filter(({ kind }) => kind === "earlier")
      .reduce((sum, { rolledCount }) => sum + rolledCount, 0);
    const named = [];
    if (fromEarlier > 0) {
      named.push(
        `${fromEarlier} from ${
          fromEarlier === 1 ? "an earlier note" : "earlier notes"
        }`
      );
    }
    for (const { kind, name, rolledCount } of contributors) {
      if (kind !== "previous" && kind !== "earlier") {
        named.push(`${rolledCount} from ${name}`);
      }
    }
    // with a single contributing source, naming it would only repeat the count
    const parts =
      named.length > 0 && contributors.length > 1
        ? ` (${named.join(", ")})`
        : "";
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
  if (doneElsewhereCount > 0) {
    lines.push(`- ${doneElsewhereCount} already done in a newer note.`);
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
 * How a notice names a source: "the previous day's note", "the inbox note
 * 'Inbox'" or, for an older daily note, "the daily note '2026-11-14'".
 *
 * @param {{ kind: string, name: string }} source
 */
export function sourceLabel(source) {
  if (source.kind === "inbox") return `the inbox note '${source.name}'`;
  if (source.kind === "earlier") return `the daily note '${source.name}'`;
  return "the previous day's note";
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
  return `Rollover left ${sourceLabel(
    source
  )} unchanged: it was edited while the rollover was running.`;
}

/**
 * The sources templaterNotice() names: every one but an older daily note with
 * nothing to write (only Leave items), which would have stayed unchanged
 * anyway. The previous note and the inbox are always named, so their notice
 * keeps its text.
 *
 * @param {object[]} sources
 * @param {object[]} perSource - applySources().perSource, one per source
 */
export function templaterNoticeSources(sources, perSource) {
  return sources.filter(
    (source, i) =>
      source.kind !== "earlier" || sourceNeedsWrite(source, perSource[i])
  );
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
