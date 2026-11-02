// Pure logic for putting yesterday's sections of todos into today's note.

import { hasHeading, insertUnderHeading } from "./get-todos";

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

    if (relativePath.length === 0) {
      if (!templateSelected) {
        result = appendToEnd(result, todosString);
        continue;
      }
      // Todos sit directly under the template heading
      if (!hasHeading(result, templateHeading)) templateHeadingNotFound = true;
      result = insertUnderHeading(
        result,
        templateHeading,
        todosString,
        leadingNewLine,
        { beforeSubHeadings: true }
      );
      continue;
    }

    // Walk the path to find the deepest heading that already exists in today's
    // note; that becomes the insertion parent and everything below it is
    // created as a block.
    const todayLines = result.split(/\r?\n|\r|\n/g);
    let insertUnder = templateSelected ? templateHeading : null;
    let firstMissingIdx = 0;
    relativePath.forEach((heading, i) => {
      if (todayLines.some((l) => l.toLowerCase() === heading.toLowerCase())) {
        insertUnder = heading;
        firstMissingIdx = i + 1;
      }
    });

    const missingHeadings = relativePath.slice(firstMissingIdx);
    const block = buildBlock(missingHeadings, todosString, leadingNewLine);

    if (insertUnder === null) {
      result = appendToEnd(result, block);
    } else {
      if (!hasHeading(result, insertUnder)) templateHeadingNotFound = true;
      // plain todos go before existing sub-headings; new sub-headings after them
      result = insertUnderHeading(result, insertUnder, block, leadingNewLine, {
        beforeSubHeadings: missingHeadings.length === 0,
      });
    }
  }

  // keep the last appended todo on its own line
  if (!templateSelected && result !== content && !result.endsWith("\n")) {
    result += "\n";
  }

  return { content: result, templateHeadingNotFound };
}
