// What to do with the *source* (previous day's) note after todos were rolled:
//
//   "none"   - leave it untouched (default)
//   "delete" - remove the rolled lines (the former `deleteOnComplete`)
//   "mark"   - rewrite the checkbox of each rolled open todo to a marker, e.g.
//              `- [ ] x` -> `- [>] x` (bullet-journal "forwarded")

import { getTodos, removeEmptyHeadings, splitGraphemes } from "./get-todos";

const ACTIONS = ["none", "delete", "mark"];
const DEFAULT_MARKER = ">";
const DEFAULT_DONE_MARKERS = "xX-"; // same as the parser's default

// Captures the text around the checkbox content so it can be swapped out
const CHECKBOX_RE = /^(\s*(?:>\s*)*[*+-] \[).+?(\])/;

export function resolveSourceAction(settings) {
  return ACTIONS.includes(settings.onRolloverSourceAction)
    ? settings.onRolloverSourceAction
    : "none";
}

// Users who had `deleteOnComplete` on before this setting existed keep deleting
export function migrateSourceActionSettings(settings, storedSettings = {}) {
  if (
    storedSettings.onRolloverSourceAction === undefined &&
    storedSettings.deleteOnComplete === true
  ) {
    return { ...settings, onRolloverSourceAction: "delete" };
  }
  return settings;
}

// The marker must be a single visible grapheme; anything else falls back to ">"
export function normalizeMarker(marker) {
  if (typeof marker !== "string" || marker.trim() === "") return DEFAULT_MARKER;
  return splitGraphemes(marker).length === 1 ? marker : DEFAULT_MARKER;
}

// While marking, the marker counts as "done" for the parser, so a rolled and
// marked todo is not rolled a second time. The saved setting is not changed.
export function effectiveDoneStatusMarkers(settings) {
  if (resolveSourceAction(settings) !== "mark") {
    return settings.doneStatusMarkers || "";
  }
  // An empty setting means the parser's default markers, which must be kept
  const doneStatusMarkers = settings.doneStatusMarkers || DEFAULT_DONE_MARKERS;
  const marker = normalizeMarker(settings.rolloverSourceMarker);
  return doneStatusMarkers.includes(marker)
    ? doneStatusMarkers
    : `${doneStatusMarkers}${marker}`;
}

const indentationOf = (line) => line.search(/\S/);

// Positions of the rolled lines that sit under another rolled line, i.e. the
// hierarchy that moved along with a marked todo, except those in `retain`
function nestedLineIndices(lines, rolledLineIndices, retain) {
  const sorted = [...new Set(rolledLineIndices)]
    .filter((i) => i >= 0 && i < lines.length)
    .sort((a, b) => a - b);
  const nested = new Set();
  let head = null; // { index, indentation } of the last top-level rolled line

  for (const index of sorted) {
    const indentation = indentationOf(lines[index]);
    let underHead = head !== null && indentation > head.indentation;
    // every line between the head and this one has to be nested under it too
    for (let k = head ? head.index + 1 : 0; underHead && k < index; k++) {
      if (indentationOf(lines[k]) <= head.indentation) underHead = false;
    }
    if (underHead) {
      if (!retain.has(index)) nested.add(index);
    } else {
      head = { index, indentation };
    }
  }
  return nested;
}

/**
 * Lines are addressed by position, never by text, so identical lines that were
 * not rolled (under another parent, in a code block) are left alone.
 *
 * @param {object} args
 * @param {string} args.content - the source note's current content; positions
 *   refer to its lines split on "\n"
 * @param {"none"|"delete"|"mark"} args.action
 * @param {number[]} args.rolledLineIndices - lines that were rolled over
 * @param {number[]} [args.deletedLineIndices] - lines to remove for "delete";
 *   defaults to rolledLineIndices (can also include empty todos that were not
 *   rolled)
 * @param {number[]} [args.skippedLineIndices] - lines removed along with their
 *   rolled parent for "delete" (see skipCompletedChildren)
 * @param {string} [args.marker] - checkbox character for "mark"
 * @param {string} [args.doneStatusMarkers] - which checkbox characters count as
 *   done; "mark" only rewrites todos that are not done
 * @param {boolean} [args.ignoreBlockquotes] - "mark" leaves blockquoted lines alone
 * @param {boolean} [args.moveNested] - "mark" keeps only the marked todo and
 *   removes the rolled lines nested under it, since they moved to today's note.
 *   Nested lines that were not rolled (skipped completed children) stay.
 * @param {number[]} [args.retainLineIndices] - nested lines that "moveNested"
 *   must not remove, because they did not move
 * @returns {{ content: string, changed: boolean }}
 */
export function applySourceAction({
  content,
  action,
  rolledLineIndices = [],
  deletedLineIndices = rolledLineIndices,
  skippedLineIndices = [],
  marker = DEFAULT_MARKER,
  doneStatusMarkers = null,
  ignoreBlockquotes = false,
  moveNested = false,
  retainLineIndices = [],
}) {
  if (action === "delete") {
    const toDelete = new Set([...deletedLineIndices, ...skippedLineIndices]);
    const lines = content
      .split("\n")
      .filter((_, index) => !toDelete.has(index));
    // headings whose todos all moved over are removed, since they now live in
    // today's note
    const newContent = removeEmptyHeadings(lines).join("\n");
    return { content: newContent, changed: newContent !== content };
  }

  if (action === "mark") {
    const rolled = new Set(rolledLineIndices);
    const allLines = content.split("\n");
    const removed = moveNested
      ? nestedLineIndices(allLines, rolledLineIndices, new Set(retainLineIndices))
      : new Set();
    const newContent = allLines
      .map((line, index) => {
        if (!rolled.has(index)) return line;
        // Rolled completed children keep their checkbox; only open todos move.
        // Checked without a trailing \r so CRLF files work too.
        const text = line.replace(/\r$/, "");
        if (
          getTodos({ lines: [text], doneStatusMarkers, ignoreBlockquotes })
            .length === 0
        ) {
          return line;
        }
        return line.replace(CHECKBOX_RE, (_, open, close) => `${open}${marker}${close}`);
      })
      .filter((_, index) => !removed.has(index))
      .join("\n");
    return { content: newContent, changed: newContent !== content };
  }

  return { content, changed: false };
}
