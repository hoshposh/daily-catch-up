// Pure helpers for building the backlog note's new content from todos the user
// parked during review.

import { insertField, stripRolledCount } from "./rolled-count";
import { insertSections } from "./insert-sections";

const leadingWhitespace = (line) => /^\s*/.exec(line)[0];

// Remove up to `width` leading whitespace characters, never other characters
function dedent(line, width) {
  const available = Math.min(width, leadingWhitespace(line).length);
  return line.slice(available);
}

/**
 * The lines to write for `items`: each item dedented by its head's indentation,
 * with the head's rolled counter removed and `[from:: [[sourceNoteName]]]` added.
 */
export function backlogLines(items, sourceNoteName) {
  const origin = `[from:: [[${sourceNoteName}]]]`;
  return items.flatMap(({ lines }) => {
    const width = leadingWhitespace(lines[0]).length;
    const [head, ...rest] = lines.map((line) => dedent(line, width));
    return [insertField(stripRolledCount(head), origin), ...rest];
  });
}

// A heading typed without leading `#` becomes a level 2 heading
function normalizeHeading(heading) {
  const trimmed = heading.trim();
  return trimmed.startsWith("#") ? trimmed : `## ${trimmed}`;
}

/**
 * The backlog note's content with `items` added under `heading` (created when
 * missing), or at the end of the note when `heading` is empty.
 */
export function appendToBacklog({
  content,
  heading,
  items,
  sourceNoteName,
  leadingNewLine,
}) {
  const sections = [
    {
      headingPath: heading && heading.trim() ? [normalizeHeading(heading)] : [],
      incompleteTodos: backlogLines(items, sourceNoteName),
    },
  ];
  return insertSections({
    content,
    sections,
    templateHeading: "none",
    leadingNewLine,
  }).content;
}
