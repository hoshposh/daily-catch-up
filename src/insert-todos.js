// Pure helpers for choosing which rolled todos get inserted into today's note.

import { getTodos } from "./get-todos";

// An open or closed checkbox list item, e.g. "- [ ] text" or "> * [/] text"
const CHECKBOX_LINE = /^\s*(?:>\s*)*[*+-] \[.+?\]/;

const indentationOf = (line) => line.search(/\S/);

const isOpenTodo = (line, doneStatusMarkers) =>
  getTodos({ lines: [line], doneStatusMarkers }).length > 0;

// Whether the children of a duplicate parent allow it to be skipped. Every child
// has to be in the note already, except completed todos: they have no work left
// to carry (they are skipped along with the parent), unless an open todo sits
// under them, which then has to be in the note.
function childrenAllowSkip(children, existing, doneStatusMarkers) {
  for (let c = 0; c < children.length; c++) {
    const child = children[c];
    if (existing.has(child.trim())) continue;
    if (!CHECKBOX_LINE.test(child) || isOpenTodo(child, doneStatusMarkers)) {
      return false;
    }
    // a completed child: ignore its whole subtree when that has no open todo
    const indentation = indentationOf(child);
    let end = c + 1;
    while (end < children.length && indentationOf(children[end]) > indentation) {
      end++;
    }
    const subtree = children.slice(c + 1, end);
    if (!subtree.some((line) => isOpenTodo(line, doneStatusMarkers))) {
      c = end - 1;
    }
  }
  return true;
}

/**
 * Drops rolled todos that already exist in `existingContent`, so recurring
 * tasks baked into a daily template are not duplicated.
 *
 * - Only checkbox lines are compared (trimmed, exact incl. the checkbox), never
 *   plain text.
 * - With `withChildren`, todos are handled as groups. A duplicate parent is
 *   dropped with its children only when every child is also already in the
 *   note, apart from completed todos, which do not stop it (see
 *   childrenAllowSkip). Otherwise the group is kept, so nothing that is not in
 *   today's note is lost. A duplicate child under a kept parent is kept.
 *   Without `withChildren`, indented todos are independent items.
 *
 * @param {string[]} todos - the rolled lines, children included
 * @param {string} existingContent - today's note before anything is inserted
 * @param {boolean} [withChildren=true] - whether indented lines belong to the
 *   todo above them (the "roll over children" setting)
 * @param {string|null} [doneStatusMarkers] - which checkbox characters count as
 *   done; null for the parser's defaults
 * @returns {{ todos: string[], skipped: number, duplicates: string[], droppedIndices: number[] }}
 *   `skipped` counts every dropped line; `duplicates` are the dropped lines
 *   that really are in the note (dropped completed children are not);
 *   `droppedIndices` are the positions of the dropped lines in `todos`
 */
export function dedupeAgainstExisting(
  todos,
  existingContent,
  withChildren = true,
  doneStatusMarkers = null
) {
  const existing = new Set(existingContent.split("\n").map((l) => l.trim()));
  const kept = [];
  const dropped = [];
  const droppedIndices = [];

  let i = 0;
  while (i < todos.length) {
    const head = todos[i];
    const headIndentation = indentationOf(head);
    let end = i + 1;
    if (withChildren) {
      while (end < todos.length && indentationOf(todos[end]) > headIndentation) {
        end++;
      }
    }
    const group = todos.slice(i, end);
    const isDuplicate =
      CHECKBOX_LINE.test(head) &&
      existing.has(head.trim()) &&
      childrenAllowSkip(group.slice(1), existing, doneStatusMarkers);

    (isDuplicate ? dropped : kept).push(...group);
    if (isDuplicate) {
      for (let k = i; k < end; k++) droppedIndices.push(k);
    }
    i = end;
  }

  return {
    todos: kept,
    skipped: dropped.length,
    duplicates: dropped.filter((line) => existing.has(line.trim())),
    droppedIndices,
  };
}

// Number of times each (trimmed) line occurs in `lines`
function countLines(lines) {
  const counts = new Map();
  for (const line of lines) {
    const key = line.trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * True when today's note still holds what the rollover put there. Another
 * plugin (Templater) may rewrite a new note right after we wrote to it, and a
 * rolled line can also be a line the template already had, so a line only
 * counts when it occurs as often as in the original note plus once per copy we
 * inserted.
 *
 * @param {string} content - today's note after things settled
 * @param {string[]} todos - lines that were inserted
 * @param {string} [baseContent] - today's note before the insertion
 * @param {string[]} [alreadyPresent] - rolled lines that were skipped because
 *   the note already had them; these must still be there
 */
export function verifyTodosPresent(
  content,
  todos,
  baseContent = "",
  alreadyPresent = []
) {
  const actual = countLines(content.split(/\r?\n/));
  const base = countLines(baseContent.split(/\r?\n/));
  const inserted = countLines(todos);
  const lines = new Set([...inserted.keys(), ...alreadyPresent.map((l) => l.trim())]);

  for (const line of lines) {
    const expected = (base.get(line) || 0) + (inserted.get(line) || 0);
    if ((actual.get(line) || 0) < expected) return false;
  }
  return true;
}

const EMPTY_TODO = /^- \[ {1,2}\]$/;

/**
 * Removes empty todos (`- [ ]`) from the sections that will be rolled over,
 * keeping each section's line positions in step with its todos, and drops
 * sections left without todos.
 *
 * @param {{ incompleteTodos: string[], incompleteLineIndices: number[] }[]} sections
 * @returns {{ sections: object[], kept: number, removed: number }}
 */
export function dropEmptyTodos(sections) {
  let kept = 0;
  let removed = 0;
  const result = [];

  for (const section of sections) {
    const incompleteTodos = [];
    const incompleteLineIndices = [];
    section.incompleteTodos.forEach((line, i) => {
      if (EMPTY_TODO.test((line || "").trim())) {
        removed++;
      } else {
        incompleteTodos.push(line);
        incompleteLineIndices.push(section.incompleteLineIndices[i]);
      }
    });
    kept += incompleteTodos.length;
    if (incompleteTodos.length > 0) {
      result.push({ ...section, incompleteTodos, incompleteLineIndices });
    }
  }

  return { sections: result, kept, removed };
}
