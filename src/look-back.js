// Look back: a rollover also reads the daily notes of the last N days. Pure
// logic for when it applies, the day it starts from, and parsing its two
// settings. Days are local "YYYY-MM-DD" strings; `today` is passed in, so
// nothing here reads a clock or a date library.

import { splitGraphemes } from "./get-todos";
import { stripRolledCount } from "./rolled-count";
import {
  DEFAULT_DONE_MARKERS,
  effectiveDoneStatusMarkers,
  resolveSourceAction,
} from "./source-action";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Look back needs the previous note to be marked or deleted, and Skip existing todos. */
export function lookBackDependenciesMet(settings) {
  return (
    resolveSourceAction(settings) !== "none" &&
    settings.skipExistingTodos === true
  );
}

export function lookBackApplies(settings) {
  return (
    lookBackDependenciesMet(settings) &&
    Number.isInteger(settings.lookBackDays) &&
    settings.lookBackDays > 0
  );
}

/**
 * The done markers that make a todo in a newer note count as done: the
 * effective ones (the rollover marker counts while marking), or the parser's
 * default when the Done status markers field is empty and nothing marks, as
 * the parser itself falls back.
 */
export function lookBackDoneMarkers(settings) {
  return effectiveDoneStatusMarkers(settings) || DEFAULT_DONE_MARKERS;
}

/** A "YYYY-MM-DD" text that is a real calendar date. */
export function isValidDay(text) {
  const match = DAY.exec(text ?? "");
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * The stored start day after a settings change: today when Look back has just
 * started applying, cleared when it has stopped, else as stored.
 */
export function nextLookBackSince({ wasApplying, settings, today }) {
  const applies = lookBackApplies(settings);
  if (!wasApplying && applies) return today;
  if (wasApplying && !applies) return "";
  return settings.lookBackSince ?? "";
}

/**
 * The start day to use at rollover time: today when Look back applies but the
 * stored day is missing or invalid (`changed` tells the caller to save it).
 */
export function settledLookBackSince(settings, today) {
  if (lookBackApplies(settings) && !isValidDay(settings.lookBackSince)) {
    return { since: today, changed: true };
  }
  return { since: settings.lookBackSince ?? "", changed: false };
}

/** Whole days, 0 to 366, from a text field; undefined when it is anything else. */
export function parseLookBackDays(text) {
  const trimmed = String(text ?? "").trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const days = Number(trimmed);
  return days <= 366 ? days : undefined;
}

/**
 * The start day from a text field: empty means today; a valid day not after
 * today is kept; anything else is undefined.
 */
export function parseLookBackSince(text, today) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return today;
  // "YYYY-MM-DD" strings compare in date order
  return isValidDay(trimmed) && trimmed <= today ? trimmed : undefined;
}

// A list item's checkbox, strictly: indentation and quote prefixes, a list
// marker, then "[" one character "]" followed by a space or the end of the
// line, as the parser takes a todo. So "- [[Sam Smith]] note" (a link) and
// "- [[]] x" are plain bullets. The single character is checked with
// graphemes below, so an emoji status counts as one.
const CHECKBOX = /^(?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[([^\]]+)\](?=\s|$)/u;

// zero-width and direction characters the parser never takes as a status on
// their own
const NOT_A_STATUS = ["\u202E", "\u200B", "\u200C", "\u200D"];

/** The checkbox match of a line, or null when it is not a checkbox line. */
function matchCheckbox(line) {
  const match = CHECKBOX.exec(line);
  if (!match) return null;
  const chars = splitGraphemes(match[1]);
  if (chars.length !== 1 || NOT_A_STATUS.includes(chars[0])) return null;
  return { prefix: match[0], marker: match[1] };
}

// the done and cancelled dates Obsidian Tasks adds when a todo is completed
// or cancelled: an open todo has neither, so its done copy must match without
const TASKS_DONE_DATES = /(?:^|\s)[✅❌]\uFE0F?\s*\d{4}-\d{2}-\d{2}(?=\s|$)/gu;

/**
 * A checkbox line's text after the checkbox, without its `[rolled:: n]`
 * counter and without an Obsidian Tasks done (✅) or cancelled (❌) date,
 * runs of spaces made one, trimmed: the same for a todo and its copy in
 * another note whatever the indentation, quote prefix, list marker, counter
 * or completion date. Null for any other line.
 */
export function todoKey(line) {
  const match = matchCheckbox(line);
  if (!match) return null;
  return stripRolledCount(line.slice(match.prefix.length))
    .replace(TASKS_DONE_DATES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What sits inside a checkbox line's brackets; null for any other line. */
export function checkboxMarker(line) {
  return matchCheckbox(line)?.marker ?? null;
}

/** The `todoKey` of every checkbox line whose marker is a done marker. */
export function doneKeys(lines, doneStatusMarkers) {
  const keys = new Set();
  for (const line of lines) {
    const marker = checkboxMarker(line);
    if (marker !== null && doneStatusMarkers.includes(marker)) {
      keys.add(todoKey(line));
    }
  }
  return keys;
}

/**
 * For notes passed newest first, entry k holds the done keys of the notes
 * before k, the ones newer than note k (entry 0 is empty).
 */
export function cumulativeDoneKeys(linesList, doneStatusMarkers) {
  const result = [];
  let keys = new Set();
  for (const lines of linesList) {
    result.push(keys);
    keys = new Set([...keys, ...doneKeys(lines, doneStatusMarkers)]);
  }
  return result;
}

/**
 * Ids of the items already done in a newer note: the head's key is in
 * `newerDoneKeys` and so is the key of every open checkbox nested under it
 * (plain bullets and completed children carry no work, so they never block).
 */
export function handledItemIds(items, newerDoneKeys, doneStatusMarkers) {
  const handled = new Set();
  for (const item of items) {
    const [head, ...nested] = item.lines;
    if (!newerDoneKeys.has(todoKey(head))) continue;
    const blocked = nested.some((line) => {
      const marker = checkboxMarker(line);
      return (
        marker !== null &&
        !doneStatusMarkers.includes(marker) &&
        !newerDoneKeys.has(todoKey(line))
      );
    });
    if (!blocked) handled.add(item.id);
  }
  return handled;
}
