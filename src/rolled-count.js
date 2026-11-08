// Pure helpers for the inline `[rolled:: n]` counter field (and other inline
// fields such as `[from:: ...]`). They only touch the first line of a todo.

const ROLLED_FIELD = /\[rolled::\s*([^\]]*?)\s*\]/;
const ROLLED_FIELDS_WITH_SPACE = /\s*\[rolled::[^\]]*\]/g;

// Start of the Obsidian Tasks emoji fields. Tasks reads these from the end of
// the line, so inline fields must go before the first one. A trailing U+FE0F
// does not change where the signifier starts, so it needs no special case.
const TASKS_SIGNIFIER = /🔺|⏫|🔼|🔽|⏬|🛫|➕|⏳|📅|✅|❌|🔁|🏁|🆔|⛔/gu;
const TRAILING_BLOCK_ID = /\s\^[A-Za-z0-9-]+\s*$/;
// The list marker and checkbox at the start of a todo, blockquote prefix
// included. The checkbox holds any characters, like the parser's, so a status
// character outside the Basic Multilingual Plane (an emoji) is matched whole.
const CHECKBOX_PREFIX = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[[^\]]+\]/u;

export function parseRolledCount(line) {
  const value = ROLLED_FIELD.exec(line)?.[1];
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : 0;
}

export function stripRolledCount(line) {
  return line.replace(ROLLED_FIELDS_WITH_SPACE, "");
}

export function setRolledCount(line, n) {
  return insertField(stripRolledCount(line), `[rolled:: ${n}]`);
}

// Put `field` before the first Tasks signifier, else before a trailing block
// id, else at the end of the line. A trailing carriage return stays last.
export function insertField(line, field) {
  const cr = line.endsWith("\r") ? "\r" : "";
  const text = cr ? line.slice(0, -1) : line;

  // Search only after the checkbox. A signifier with no description text before
  // it (a todo that starts with an emoji) is skipped, so the field never goes
  // before all of the todo's text.
  const start = CHECKBOX_PREFIX.exec(text)?.[0].length ?? 0;
  for (const signifier of text.slice(start).matchAll(TASKS_SIGNIFIER)) {
    const at = start + signifier.index;
    if (text.slice(start, at).trim() === "") continue;
    return `${text.slice(0, at).trimEnd()} ${field} ${text.slice(at)}${cr}`;
  }

  const blockId = TRAILING_BLOCK_ID.exec(text);
  if (blockId) {
    return `${text.slice(0, blockId.index)} ${field}${text.slice(
      blockId.index
    )}${cr}`;
  }

  return `${text} ${field}${cr}`;
}
