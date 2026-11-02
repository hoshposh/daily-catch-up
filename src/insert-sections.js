// Pure logic for putting yesterday's sections of todos into today's note.

import { insertUnderHeading } from "./get-todos";

// A created heading is followed by a blank line before the todos when
// leadingNewLine is on, like the todos under an existing heading
function buildBlock(missingHeadings, todosString, leadingNewLine) {
  const parts = [...missingHeadings];
  if (missingHeadings.length > 0 && leadingNewLine) parts.push("");
  parts.push(todosString);
  return parts.join("\n");
}

function appendToEnd(content, block) {
  return content === "" ? block : `${content}\n${block}`;
}

const normalize = (text) => text.trim().toLowerCase();

// Headings of `lines` as { index, level, key }, where key is the normalized line
function headingsOf(lines) {
  const headings = [];
  lines.forEach((line, index) => {
    const match = /^(#{1,6}) /.exec(line);
    if (match) headings.push({ index, level: match[1].length, key: normalize(line) });
  });
  return headings;
}

// The lines [start, end) a heading's section covers: up to the next heading of
// the same or a higher level, but never past `limit`
function sectionOf(headings, heading, limit) {
  const next = headings.find(
    (h) => h.index > heading.index && h.level <= heading.level
  );
  return { start: heading.index + 1, end: Math.min(next ? next.index : limit, limit) };
}

/**
 * Finds where in `content` a path of headings continues. Each heading is looked
 * for only inside the section of the one before it, so a heading of the same
 * name under another parent is never used, and the lookup stops at the first
 * heading that is missing.
 *
 * @param {string} content
 * @param {string|null} rootHeading - the template heading the path is below, or
 *   null to look in the whole note
 * @param {string[]} path - headings, outermost first
 * @returns {{ parentLine: number|null, found: number, rootMissing: boolean }}
 *   parentLine is the line of the deepest heading found (the root when none of
 *   the path was), found how many of the path's headings exist
 */
function locateHeadingPath(content, rootHeading, path) {
  const lines = content.split("\n");
  const headings = headingsOf(lines);
  let scope = { start: 0, end: lines.length };
  let parentLine = null;

  if (rootHeading !== null) {
    const root = headings.find((h) => h.key === normalize(rootHeading));
    if (!root) return { parentLine: null, found: 0, rootMissing: true };
    parentLine = root.index;
    scope = sectionOf(headings, root, lines.length);
  }

  let found = 0;
  for (const heading of path) {
    const match = headings.find(
      (h) =>
        h.index >= scope.start && h.index < scope.end && h.key === normalize(heading)
    );
    if (!match) break;
    parentLine = match.index;
    scope = sectionOf(headings, match, scope.end);
    found++;
  }
  return { parentLine, found, rootMissing: false };
}

/**
 * Inserts each section's todos into `content`, under the heading they had in
 * yesterday's note. Headings that today's note already has are reused
 * (case-insensitively); missing ones are created, nested as in yesterday's note.
 *
 * - With a `templateHeading`, sections go under it, with their headings
 *   created relative to it.
 * - Without one ("none"), sections go under their own headings, which are
 *   created at the end of the note when missing. Todos that were not under any
 *   heading are appended without one.
 *
 * @param {object} args
 * @param {string} args.content - today's note
 * @param {{ headingPath: string[], incompleteTodos: string[] }[]} args.sections
 * @param {string} [args.templateHeading="none"]
 * @param {boolean} [args.leadingNewLine=true] - blank line before inserted text
 * @returns {{ content: string, templateHeadingNotFound: boolean }}
 */
export function insertSections({
  content,
  sections,
  templateHeading = "none",
  leadingNewLine = true,
}) {
  const templateSelected = templateHeading !== "none";
  let result = content;
  let templateHeadingNotFound = false;

  for (const section of sections) {
    const todosString = section.incompleteTodos.join("\n");

    // headings to find or create, outermost first
    const templateIdx = templateSelected
      ? section.headingPath.findIndex(
          (h) => h.toLowerCase() === templateHeading.toLowerCase()
        )
      : -1;
    const relativePath =
      templateIdx >= 0
        ? section.headingPath.slice(templateIdx + 1)
        : section.headingPath;

    if (relativePath.length === 0 && !templateSelected) {
      // todos that were not under any heading
      result = appendToEnd(result, todosString);
      continue;
    }

    // Find the deepest heading of the path that today's note already has (each
    // inside its parent's section); what is missing below it is created.
    const located = locateHeadingPath(
      result,
      templateSelected ? templateHeading : null,
      relativePath
    );
    const missingHeadings = relativePath.slice(located.found);
    const block = buildBlock(missingHeadings, todosString, leadingNewLine);
    // plain todos go before existing sub-headings; new sub-headings after them
    const beforeSubHeadings = missingHeadings.length === 0;

    if (located.rootMissing) {
      // insertUnderHeading appends at the end of the note when its heading is
      // missing, so only the user needs to be told
      templateHeadingNotFound = true;
      result = insertUnderHeading(result, templateHeading, block, leadingNewLine, {
        beforeSubHeadings,
      });
    } else if (located.parentLine === null) {
      result = appendToEnd(result, block);
    } else {
      const parent = result.split("\n")[located.parentLine].replace(/\r$/, "");
      result = insertUnderHeading(result, parent, block, leadingNewLine, {
        beforeSubHeadings,
        headingLineIndex: located.parentLine,
      });
    }
  }

  // keep the last appended todo on its own line
  if (!templateSelected && result !== content && !result.endsWith("\n")) {
    result += "\n";
  }

  return { content: result, templateHeadingNotFound };
}
