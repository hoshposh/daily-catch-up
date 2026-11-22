// Look back: a rollover also reads the daily notes of the last N days. Pure
// logic for when it applies, the day it starts from, and parsing its two
// settings. Days are local "YYYY-MM-DD" strings; `today` is passed in, so
// nothing here reads a clock or a date library.

import { resolveSourceAction } from "./source-action";

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
