// Undo for a note that may have gained lines since the rollover (the inbox: a
// capture can sync in during the undo window). A three-way line merge: the
// snapshot from before the rollover, the note as the rollover left it, and
// the note as it is now. Pure, so it is unit tested. Lines are split on "\n"
// only, so a "\r" stays part of its line. A capture placed between lines the
// rollover changed (Mark) is restored after them.

/**
 * Line diff by longest common subsequence. Returns, for each line of `a`, the
 * index of the line of `b` it is matched to, or -1. Notes are small, so the
 * quadratic table is fine; the common start and end are trimmed off first.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number[]}
 */
function matchLines(a, b) {
  const matched = new Array(a.length).fill(-1);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    matched[start] = start;
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    matched[endA] = endB;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) return matched;

  // table[i][j]: length of the longest common subsequence of a[start + i ..]
  // and b[start + j ..]
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        a[start + i] === b[start + j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      matched[start + i] = start + j;
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return matched;
}

/**
 * The runs of lines `current` has that `after` does not (insertions in a line
 * diff of `after` to `current`), each with the index of the `after` line that
 * follows it (the `after` line the next matched `current` line is matched to;
 * `after.length` when no matched line follows).
 * @param {string[]} after
 * @param {string[]} current
 * @returns {{ lines: string[], afterIndex: number }[]}
 */
function insertedRuns(after, current) {
  const afterOf = new Array(current.length).fill(-1);
  matchLines(after, current).forEach((currentIndex, afterIndex) => {
    if (currentIndex >= 0) afterOf[currentIndex] = afterIndex;
  });

  const runs = [];
  let run = null;
  for (let i = 0; i < current.length; i++) {
    if (afterOf[i] === -1) {
      if (run == null) {
        run = { lines: [], afterIndex: after.length };
        runs.push(run);
      }
      run.lines.push(current[i]);
    } else {
      if (run != null) run.afterIndex = afterOf[i];
      run = null;
    }
  }
  return runs;
}

/**
 * How many lines `restoreKeepingNewLines()` would keep: the lines `current`
 * has that `after` does not.
 * @param {{ after: string, current: string }} args
 * @returns {number}
 */
export function addedLineCount({ after, current }) {
  if (current === after) return 0;
  return insertedRuns(after.split("\n"), current.split("\n")).reduce(
    (count, run) => count + run.lines.length,
    0
  );
}

/**
 * The note put back to `before`, with the lines added since the rollover put
 * back on top. Each run of new lines goes just before the `before` line that
 * matches the first `after` line after it that has a match, so lines the
 * rollover removed at that spot come first; with no such line, at the end
 * (before a trailing empty line, when the note ends with a newline). Lines
 * dropped since the rollover are not carried over (they come back with
 * `before`); a changed line counts as new, so its edited text is kept next to
 * the restored original.
 * @param {{ before: string, after: string, current: string }} args
 * @returns {string}
 */
export function restoreKeepingNewLines({ before, after, current }) {
  if (current === after) return before;

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeOf = matchLines(afterLines, beforeLines);

  // insertions per position in `before` (index = the line they go in front of)
  const insertAt = new Map();
  const end =
    beforeLines[beforeLines.length - 1] === ""
      ? beforeLines.length - 1
      : beforeLines.length;
  for (const run of insertedRuns(afterLines, current.split("\n"))) {
    let position = end;
    for (let i = run.afterIndex; i < afterLines.length; i++) {
      if (beforeOf[i] >= 0) {
        position = beforeOf[i];
        break;
      }
    }
    insertAt.set(position, [...(insertAt.get(position) ?? []), ...run.lines]);
  }

  const merged = [];
  for (let i = 0; i <= beforeLines.length; i++) {
    if (insertAt.has(i)) merged.push(...insertAt.get(i));
    if (i < beforeLines.length) merged.push(beforeLines[i]);
  }
  return merged.join("\n");
}
