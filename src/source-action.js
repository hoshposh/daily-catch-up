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
    const newContent = content
      .split("\n")
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
      .join("\n");
    return { content: newContent, changed: newContent !== content };
  }

  return { content, changed: false };
}
