// Pure helpers for choosing which rolled todos get inserted into today's note.

// An open or closed checkbox list item, e.g. "- [ ] text" or "> * [/] text"
const CHECKBOX_LINE = /^\s*(?:>\s*)*[*+-] \[.+?\]/;

const indentationOf = (line) => line.search(/\S/);

/**
 * Drops rolled todos that already exist in `existingContent`, so recurring
 * tasks baked into a daily template are not duplicated.
 *
 * - Only checkbox lines are compared (trimmed, exact incl. the checkbox), never
 *   plain text.
 * - Todos are handled as groups: a duplicate parent takes its indented
 *   children with it, while a duplicate child under a kept parent is kept.
 *
 * @param {string[]} todos - the rolled lines, children included
 * @param {string} existingContent - today's note before anything is inserted
 * @returns {{ todos: string[], skipped: number }} skipped counts dropped lines
 */
export function dedupeAgainstExisting(todos, existingContent) {
  const existing = new Set(existingContent.split("\n").map((l) => l.trim()));
  const kept = [];
  let headIndentation = null;
  let headDropped = false;

  for (const line of todos) {
    const indentation = indentationOf(line);
    const isChild = headIndentation !== null && indentation > headIndentation;
    if (isChild) {
      if (!headDropped) kept.push(line);
      continue;
    }
    headIndentation = indentation;
    headDropped = CHECKBOX_LINE.test(line) && existing.has(line.trim());
    if (!headDropped) kept.push(line);
  }

  return { todos: kept, skipped: todos.length - kept.length };
}
