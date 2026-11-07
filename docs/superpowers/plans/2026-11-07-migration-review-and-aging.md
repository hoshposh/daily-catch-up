# Migration Review and Todo Aging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a review dialog that decides per todo what a rollover does (Roll / Backlog / Cancel / Leave), and a `[rolled:: n]` counter that flags todos which keep rolling without being done.

**Architecture:** All decisions are pure functions in new modules (`rolled-count.js`, `rollover-items.js`, `backlog.js`) plus small additions to `source-action.js` and `insert-todos.js`, each with vitest tests. `rollover()` in `src/index.js` gains one new stage between collecting and inserting, and a thin `ReviewModal` collects decisions. The previous note is still changed by line position, inside the existing `vault.process` guard.

**Tech Stack:** Plain JavaScript ES modules, rollup → `main.js`, vitest, Obsidian API (`Modal`, `Setting`, `Notice`, `normalizePath`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-03-migration-review-and-aging-design.md`

## Global Constraints

- No new runtime or dev dependencies. `obsidian` stays external.
- Every new setting goes in `loadSettings()` `DEFAULT_SETTINGS` with exactly these defaults: `trackRolloverCount: false`, `staleAfterRollovers: 5`, `staleBehavior: "keep"`, `reviewOnAutoRollover: "off"`, `backlogNotePath: ""`, `backlogHeading: ""`, `cancelMarker: "-"`.
- With all new settings at their defaults and the new command unused, rollover output must be byte-identical to today's. The existing 206 tests must keep passing unchanged.
- Outcome values are the strings `"roll"`, `"backlog"`, `"cancel"`, `"leave"`. `reviewOnAutoRollover` is `"off" | "stale" | "always"`. `staleBehavior` is `"keep" | "backlog"`.
- Counter field text is exactly `[rolled:: n]`; backlog origin field is exactly `[from:: [[<source note basename>]]]`.
- Only the first line of an item carries a counter. Counts increase by 1 per rollover, not per day.
- UI: Obsidian `Modal`/`Setting` only, theme CSS variables only (no hard-coded colours), usable at phone width. Group titles in the settings tab use `new Setting(el).setName(...).setHeading()`.
- Commit messages: plain imperative subject, no `Co-Authored-By` or `Claude-Session` lines (user's global CLAUDE.md).
- Run tests with `pnpm vitest run <file>` (single file) or `pnpm vitest run` (all). `pnpm build` must succeed at the end of every task that touches `src/index.js` or `src/ui/`.

## Deviation from the spec (decided while planning)

The spec puts the counter "at the end of the line, but before a trailing block id". The spec's anti-goals forbid breaking Tasks parsing, and Tasks reads its emoji fields (`📅 2026-11-10`, `🔁 every week`, …) from the end of the line, so text after them hides them. The counter therefore goes **before the first Tasks signifier** if the line has one, otherwise before a trailing block id, otherwise at the end. Task 1 pins this.

## Review Focus

1. **Tasks emoji fields on the line** (`- [ ] Pay rent 📅 2026-11-10`): the counter must go before them so Tasks still sees the date. Test in Task 1.
2. **Two identical todo lines in the previous note:** item ids are positional, so deciding Cancel for one leaves the other rolling. Test in Task 3.
3. **A Leave or Cancel item whose completed children were skipped** (`skipCompletedChildren` on) **with "after rollover: delete":** those children must not be deleted. Test in Task 3.
4. **A nested todo sent to the backlog without `rolloverChildren`** (head line indented): it is dedented, so it does not become a child of whatever ends the backlog note. Test in Task 5.
5. **CRLF notes:** counter writing keeps the trailing `\r`; cancel marking keeps it too. Tests in Task 1 and Task 4.

---

## Setup (before Task 1)

- [ ] Create branch `feat/review-and-aging` from `main` (or a worktree via superpowers:using-git-worktrees).
- [ ] Commit the spec and this plan:

```bash
git add docs/superpowers
git commit -m "Add design and plan for migration review and todo aging"
```

---

### Task 1: Counter field helpers

**Files:**

- Create: `src/rolled-count.js`
- Test: `src/rolled-count.test.js`

**Interfaces:**

- Produces:

  - `parseRolledCount(line: string): number` — numeric value of `[rolled:: n]`, else `0`.
  - `stripRolledCount(line: string): string` — removes every `[rolled:: …]` field (numeric or not) and the whitespace before it.
  - `setRolledCount(line: string, n: number): string` — strips, then inserts `[rolled:: n]` at the insertion point.
  - `insertField(line: string, field: string): string` — inserts `${field}` at the insertion point (used by Task 5 for `[from:: …]`).
  - Insertion point: before the first Tasks signifier among `🔺 ⏫ 🔼 🔽 ⏬ 🛫 ➕ ⏳ 📅 ✅ ❌ 🔁 🏁 🆔 ⛔` (match with or without a trailing U+FE0F), else before a trailing block id (`/\s\^[A-Za-z0-9-]+\s*$/`), else at end. A trailing `\r` is preserved after everything.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, expect, test } from "vitest";
import {
  insertField,
  parseRolledCount,
  setRolledCount,
  stripRolledCount,
} from "./rolled-count";

describe("parseRolledCount", () => {
  test("reads the number", () =>
    expect(parseRolledCount("- [ ] a [rolled:: 3]")).toBe(3));
  test("missing field is 0", () => expect(parseRolledCount("- [ ] a")).toBe(0));
  test("non-numeric field is 0", () =>
    expect(parseRolledCount("- [ ] a [rolled:: x]")).toBe(0));
});

describe("setRolledCount", () => {
  test("appends at the end", () =>
    expect(setRolledCount("- [ ] a", 1)).toBe("- [ ] a [rolled:: 1]"));
  test("replaces an existing field, numeric or not", () => {
    expect(setRolledCount("- [ ] a [rolled:: 2]", 3)).toBe(
      "- [ ] a [rolled:: 3]",
    );
    expect(setRolledCount("- [ ] a [rolled:: x]", 1)).toBe(
      "- [ ] a [rolled:: 1]",
    );
  });
  test("goes before a trailing block id", () =>
    expect(setRolledCount("- [ ] a ^abc-1", 1)).toBe(
      "- [ ] a [rolled:: 1] ^abc-1",
    ));
  test("goes before Tasks fields so Tasks still parses them", () =>
    expect(
      setRolledCount(
        "- [ ] Pay rent [rolled:: 2] 📅 2026-11-10 🔁 every month",
        3,
      ),
    ).toBe("- [ ] Pay rent [rolled:: 3] 📅 2026-11-10 🔁 every month"));
  test("keeps a trailing carriage return", () =>
    expect(setRolledCount("- [ ] a\r", 1)).toBe("- [ ] a [rolled:: 1]\r"));
  test("is idempotent for the same n", () => {
    const once = setRolledCount("- [ ] a ^id", 2);
    expect(setRolledCount(once, 2)).toBe(once);
  });
});

describe("stripRolledCount", () => {
  test("removes the field and its space", () => {
    expect(stripRolledCount("- [ ] a [rolled:: 4] ^id")).toBe("- [ ] a ^id");
    expect(stripRolledCount("- [ ] a")).toBe("- [ ] a");
  });
});

describe("insertField", () => {
  test("uses the same insertion point", () =>
    expect(
      insertField("- [ ] a 📅 2026-11-10", "[from:: [[2026-11-06]]]"),
    ).toBe("- [ ] a [from:: [[2026-11-06]]] 📅 2026-11-10"));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/rolled-count.test.js`
Expected: FAIL, cannot resolve `./rolled-count`.

- [ ] **Step 3: Implement the four exports in `src/rolled-count.js`** with the signatures and insertion point above. Search for signifiers only after the checkbox (`- [ ]`), so a todo whose text starts with an emoji still gets the field after its text.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/rolled-count.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rolled-count.js src/rolled-count.test.js
git commit -m "Add helpers for the [rolled:: n] counter field"
```

---

### Task 2: Duplicate check and Templater check ignore counters

**Files:**

- Modify: `src/insert-todos.js` (`dedupeAgainstExisting`, `childrenAllowSkip`, `countLines` callers in `verifyTodosPresent`)
- Test: `src/insert-todos.test.js`

**Interfaces:**

- Consumes: `stripRolledCount` (Task 1).
- Produces: unchanged signatures. Comparison keys become `stripRolledCount(line).trim()` on both sides.

- [ ] **Step 1: Write the failing tests** (append to the existing `describe` blocks)

```js
test("ignores the rollover counter on either side", () => {
  const a = dedupeAgainstExisting(
    ["- [ ] Standup [rolled:: 2]"],
    "- [ ] Standup\n",
  );
  expect(a.skipped).toBe(1);
  const b = dedupeAgainstExisting(
    ["- [ ] Standup"],
    "- [ ] Standup [rolled:: 1]\n",
  );
  expect(b.skipped).toBe(1);
});

test("verifyTodosPresent ignores counters", () => {
  expect(
    verifyTodosPresent(
      "- [ ] Standup [rolled:: 3]\n",
      ["- [ ] Standup [rolled:: 3]"],
      "",
    ),
  ).toBe(true);
  expect(
    verifyTodosPresent("- [ ] Standup\n", ["- [ ] Standup [rolled:: 3]"], ""),
  ).toBe(true);
});
```

- [ ] **Step 2: Run to verify the dedupe test fails**

Run: `pnpm vitest run src/insert-todos.test.js`
Expected: the new dedupe test FAILS (`skipped` is 0). The verify test may already pass on its first assertion only.

- [ ] **Step 3: Normalise every comparison key** in `insert-todos.js` with `stripRolledCount(...).trim()`: the `existing` set, the `head` lookup, child lookups in `childrenAllowSkip`, `duplicates` filtering, and `countLines`.

- [ ] **Step 4: Run all tests**

Run: `pnpm vitest run`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/insert-todos.js src/insert-todos.test.js
git commit -m "Ignore the rollover counter when comparing todos"
```

---

### Task 3: Items, staleness and decisions

**Files:**

- Create: `src/rollover-items.js`
- Test: `src/rollover-items.test.js`

**Interfaces:**

- Consumes: `parseRolledCount`, `setRolledCount`, `stripRolledCount` (Task 1); section shape from `getSections()` (`{ headingPath, incompleteTodos, incompleteLineIndices, skippedLineIndices? }`).
- Produces:

  - `OUTCOMES = ["roll", "backlog", "cancel", "leave"]`
  - `toItems(sections, withChildren): Item[]` where `Item = { id: string, sectionIndex: number, headingPath: string[], start: number, end: number, lines: string[], lineIndices: number[], count: number }`. `start`/`end` index into `section.incompleteTodos` (end exclusive). `id` is `` `${sectionIndex}:${start}` ``. Grouping: with `withChildren`, a head plus the following lines indented deeper than it; without, every line is its own item. `count` is `parseRolledCount(lines[0])`.
  - `isStale(item, { trackRolloverCount, staleAfterRollovers }): boolean` — `trackRolloverCount && staleAfterRollovers > 0 && item.count >= staleAfterRollovers`.
  - `defaultDecisions(items, { trackRolloverCount, staleAfterRollovers, staleBehavior, backlogEnabled }): Record<string, Outcome>` — `"backlog"` for stale items when `staleBehavior === "backlog" && backlogEnabled`, else `"roll"`.
  - `needsReview(mode, items, staleSettings): boolean` — `"always"` → `items.length > 0`; `"stale"` → any `isStale`; otherwise `false`.
  - `applyDecisions({ sections, items, decisions, foundLineIndices }): { sections, backlogItems, movedLineIndices, cancelledLineIndices, deleteLineIndices, skippedLineIndices }`:
    - `sections`: only Roll items, `incompleteTodos` and `incompleteLineIndices` filtered in step; `skippedLineIndices` kept only for skipped lines that belong to a Roll or Backlog item; empty sections dropped.
    - `backlogItems`: Backlog items in note order.
    - `movedLineIndices`: line indices of Roll + Backlog items.
    - `cancelledLineIndices`: all line indices of Cancel items.
    - `deleteLineIndices`: `foundLineIndices` minus line indices of Leave and Cancel items.
    - `skippedLineIndices`: as kept above, flattened. A skipped line belongs to the item in the same section whose head line index is the largest one below it.
  - `bumpRolledCounts(sections, withChildren): sections` — for each item's head line, `setRolledCount(line, parseRolledCount(line) + 1)`; other lines and all indices unchanged.
  - `itemLabel(item): string` — first line with list marker, checkbox and counter removed, trimmed; plus `` ` (+${n} nested)` `` when `n = lines.length - 1 > 0`.
  - `headingLabel(headingPath): string` — headings with leading `#`s and spaces removed, joined with `" › "`; `"(no heading)"` when empty.
  - `summarizeDecisions(decisions): string` — parts in this order, zeros omitted, joined by `", "`: `"N roll"`, `"N to backlog"`, `"N cancelled"`, `"N left"`. All zero → `"nothing to do"`.

- [ ] **Step 1: Write the failing tests.** Use this fixture through the file:

```js
const lines = [
  "# Work",
  "- [ ] Ship [rolled:: 5]",
  "  - [x] Changelog",
  "  - [ ] Tag",
  "- [ ] Ship",
  "## Home",
  "- [ ] Laundry",
];
const sections = getSections({
  lines,
  withChildren: true,
  skipCompletedChildren: true,
});
```

Tests and their assertions:

```js
test("groups heads with their nested lines", () => {
  const items = toItems(sections, true);
  expect(items.map((i) => [i.id, i.lines.length, i.count])).toEqual([
    ["0:0", 2, 5],
    ["0:2", 1, 0],
    ["1:0", 1, 0],
  ]);
});

test("without children every line is an item", () => {
  const flat = getSections({ lines, withChildren: false });
  expect(toItems(flat, false).length).toBe(4); // Ship, Tag, Ship, Laundry
});

test("identical lines are separate items with separate decisions", () => {
  const items = toItems(sections, true);
  const r = applyDecisions({
    sections,
    items,
    foundLineIndices: sections.flatMap((s) => s.incompleteLineIndices),
    decisions: { "0:0": "roll", "0:2": "cancel", "1:0": "roll" },
  });
  expect(r.sections[0].incompleteTodos).toEqual([
    "- [ ] Ship [rolled:: 5]",
    "  - [ ] Tag",
  ]);
  expect(r.cancelledLineIndices).toEqual([4]);
});

test("delete never removes Leave/Cancel items or their skipped children", () => {
  const items = toItems(sections, true);
  const r = applyDecisions({
    sections,
    items,
    foundLineIndices: sections.flatMap((s) => s.incompleteLineIndices),
    decisions: { "0:0": "leave", "0:2": "roll", "1:0": "backlog" },
  });
  expect(r.deleteLineIndices).toEqual([4, 6]);
  expect(r.skippedLineIndices).toEqual([]); // line 2 belongs to the Leave item
  expect(r.movedLineIndices).toEqual([4, 6]);
  expect(r.backlogItems.map((i) => i.id)).toEqual(["1:0"]);
});

test("staleness needs tracking and a threshold", () => {
  const [ship] = toItems(sections, true);
  expect(
    isStale(ship, { trackRolloverCount: true, staleAfterRollovers: 5 }),
  ).toBe(true);
  expect(
    isStale(ship, { trackRolloverCount: true, staleAfterRollovers: 6 }),
  ).toBe(false);
  expect(
    isStale(ship, { trackRolloverCount: false, staleAfterRollovers: 5 }),
  ).toBe(false);
  expect(
    isStale(ship, { trackRolloverCount: true, staleAfterRollovers: 0 }),
  ).toBe(false);
});

test("default decisions send stale items to the backlog only when enabled", () => {
  const items = toItems(sections, true);
  const s = {
    trackRolloverCount: true,
    staleAfterRollovers: 5,
    staleBehavior: "backlog",
  };
  expect(defaultDecisions(items, { ...s, backlogEnabled: true })["0:0"]).toBe(
    "backlog",
  );
  expect(defaultDecisions(items, { ...s, backlogEnabled: false })["0:0"]).toBe(
    "roll",
  );
  expect(
    defaultDecisions(items, {
      ...s,
      staleBehavior: "keep",
      backlogEnabled: true,
    })["0:0"],
  ).toBe("roll");
});

test("needsReview", () => {
  const items = toItems(sections, true);
  const s = { trackRolloverCount: true, staleAfterRollovers: 5 };
  expect(needsReview("off", items, s)).toBe(false);
  expect(needsReview("stale", items, s)).toBe(true);
  expect(needsReview("stale", items, { ...s, staleAfterRollovers: 9 })).toBe(
    false,
  );
  expect(needsReview("always", [], s)).toBe(false);
});

test("bumpRolledCounts touches only head lines", () => {
  const bumped = bumpRolledCounts(sections, true);
  expect(bumped[0].incompleteTodos).toEqual([
    "- [ ] Ship [rolled:: 6]",
    "  - [ ] Tag",
    "- [ ] Ship [rolled:: 1]",
  ]);
  expect(bumped[0].incompleteLineIndices).toEqual(
    sections[0].incompleteLineIndices,
  );
});

test("labels and summary", () => {
  const [ship] = toItems(sections, true);
  expect(itemLabel(ship)).toBe("Ship (+1 nested)");
  expect(headingLabel(["# Work", "## Release"])).toBe("Work › Release");
  expect(headingLabel([])).toBe("(no heading)");
  expect(summarizeDecisions({ a: "roll", b: "roll", c: "leave" })).toBe(
    "2 roll, 1 left",
  );
  expect(summarizeDecisions({})).toBe("nothing to do");
});
```

(Line indices in the fixture: 1 Ship, 2 Changelog (skipped), 3 Tag, 4 Ship, 6 Laundry. Confirm `sections[0].incompleteLineIndices` is `[1, 3, 4]` in a first assertion so the fixture is checked too.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/rollover-items.test.js`
Expected: FAIL, cannot resolve `./rollover-items`.

- [ ] **Step 3: Implement the exports in `src/rollover-items.js`.** Reuse the indentation grouping already used by `dedupeAgainstExisting` (`line.search(/\S/)`); keep it local rather than exporting from `insert-todos.js`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/rollover-items.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rollover-items.js src/rollover-items.test.js
git commit -m "Add review items, staleness and decision handling"
```

---

### Task 4: Cancel marking and cancel marker settings

**Files:**

- Modify: `src/source-action.js`
- Test: `src/source-action.test.js`

**Interfaces:**

- Produces:

  - `normalizeMarker(marker, fallback = ">")` — existing behaviour, with the fallback now a parameter.
  - `markCancelled({ content, lineIndices, marker, doneStatusMarkers, ignoreBlockquotes }): { content: string, changed: boolean }` — sets the checkbox of each **open** todo at `lineIndices` to `marker`; done todos and non-todo lines untouched; never adds or removes lines. Share the per-line rewrite with the existing `"mark"` branch of `applySourceAction` (extract a private helper) instead of duplicating it.
  - `effectiveDoneStatusMarkers(settings)` — **unchanged**.
  - `isCancelAvailable(settings): boolean` — true when `normalizeMarker(settings.cancelMarker, "-")` is one of `effectiveDoneStatusMarkers(settings)` (an empty `doneStatusMarkers` means the parser default `"xX-"`). Cancel is only offered when this is true, so a cancelled todo can never roll again and existing done-marker behaviour never changes (owner's decision, replacing the spec's "counts as a done marker while cancelling").

- [ ] **Step 1: Write the failing tests**

```js
test("markCancelled marks only open todos at the given lines", () => {
  const content = "- [ ] a\n  - [x] b\n  - [ ] c\n- [ ] d";
  expect(
    markCancelled({ content, lineIndices: [0, 1, 2], marker: "-" }),
  ).toEqual({
    content: "- [-] a\n  - [x] b\n  - [-] c\n- [ ] d",
    changed: true,
  });
});

test("markCancelled keeps CRLF", () => {
  expect(
    markCancelled({
      content: "- [ ] a\r\n- [ ] b",
      lineIndices: [0],
      marker: "-",
    }).content,
  ).toBe("- [-] a\r\n- [ ] b");
});

test("normalizeMarker takes a fallback", () => {
  expect(normalizeMarker("", "-")).toBe("-");
  expect(normalizeMarker("ab", "-")).toBe("-");
  expect(normalizeMarker("~", "-")).toBe("~");
});

test("Cancel is available only when its marker is a done marker", () => {
  expect(isCancelAvailable({ doneStatusMarkers: "xX-" })).toBe(true);
  expect(isCancelAvailable({ doneStatusMarkers: "" })).toBe(true); // parser default
  expect(isCancelAvailable({ doneStatusMarkers: "xX" })).toBe(false);
  expect(isCancelAvailable({ doneStatusMarkers: "xX", cancelMarker: "~" })).toBe(false);
  expect(isCancelAvailable({ doneStatusMarkers: "xX~", cancelMarker: "~" })).toBe(true);
  // while marking, the rollover marker counts as done, so it can be the cancel marker too
  expect(
    isCancelAvailable({
      doneStatusMarkers: "xX",
      onRolloverSourceAction: "mark",
      rolloverSourceMarker: ">",
      cancelMarker: ">",
    }),
  ).toBe(true);
});

test("effectiveDoneStatusMarkers does not add the cancel marker", () => {
  expect(
    effectiveDoneStatusMarkers({ doneStatusMarkers: "xX", cancelMarker: "~" }),
  ).toBe("xX");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/source-action.test.js`
Expected: the new tests FAIL (the `effectiveDoneStatusMarkers` one may already pass); existing tests pass.

- [ ] **Step 3: Implement** `normalizeMarker`'s fallback, `markCancelled` and `isCancelAvailable`. The default cancel marker `-` is in the default `doneStatusMarkers`, so Cancel is available out of the box.

- [ ] **Step 4: Run all tests**

Run: `pnpm vitest run`
Expected: PASS, with no existing test changed.

- [ ] **Step 5: Commit**

```bash
git add src/source-action.js src/source-action.test.js
git commit -m "Add cancel marking for reviewed todos"
```

---

### Task 5: Backlog note content

**Files:**

- Create: `src/backlog.js`
- Test: `src/backlog.test.js`

**Interfaces:**

- Consumes: `stripRolledCount`, `insertField` (Task 1); `insertSections` (existing); `Item` (Task 3).
- Produces:

  - `backlogLines(items, sourceNoteName): string[]` — for each item: lines dedented by the head's indentation; head line has its counter stripped and `[from:: [[sourceNoteName]]]` inserted with `insertField`.
  - `appendToBacklog({ content, heading, items, sourceNoteName, leadingNewLine }): string` — delegates to `insertSections({ content, sections: [{ headingPath: heading ? [normalizeHeading(heading)] : [], incompleteTodos: backlogLines(...) }], templateHeading: "none", leadingNewLine })` and returns its `content`. `normalizeHeading` (private): a heading without leading `#` becomes `"## " + heading.trim()`.

- [ ] **Step 1: Write the failing tests**

```js
const item = (lines) => ({ lines });

test("strips the counter, adds the origin, keeps children", () => {
  expect(
    backlogLines(
      [item(["- [ ] Ship [rolled:: 6] ^id", "  - [ ] Tag"])],
      "2026-11-06",
    ),
  ).toEqual(["- [ ] Ship [from:: [[2026-11-06]]] ^id", "  - [ ] Tag"]);
});

test("dedents a nested head", () => {
  expect(backlogLines([item(["    - [ ] Tag"])], "d")).toEqual([
    "- [ ] Tag [from:: [[d]]]",
  ]);
});

test("appends to the end without a heading", () => {
  expect(
    appendToBacklog({
      content: "- [ ] old",
      heading: "",
      items: [item(["- [ ] new"])],
      sourceNoteName: "d",
      leadingNewLine: true,
    }),
  ).toBe("- [ ] old\n- [ ] new [from:: [[d]]]");
});

test("creates a missing heading, accepting plain text", () => {
  const out = appendToBacklog({
    content: "",
    heading: "Someday",
    items: [item(["- [ ] x"])],
    sourceNoteName: "d",
    leadingNewLine: true,
  });
  expect(out).toContain("## Someday");
  expect(out.indexOf("## Someday")).toBeLessThan(out.indexOf("- [ ] x"));
});

test("adds under an existing heading", () => {
  const content = "## Someday\n\n- [ ] a\n\n## Done\n";
  const out = appendToBacklog({
    content,
    heading: "## Someday",
    items: [item(["- [ ] b"])],
    sourceNoteName: "d",
    leadingNewLine: true,
  });
  expect(out.indexOf("- [ ] b")).toBeLessThan(out.indexOf("## Done"));
  expect(out.match(/## Someday/g).length).toBe(1);
});
```

The "append to the end" expectation is the exact current `insertSections` behaviour for an existing list; if the implementer finds `insertSections` produces a different but consistent separator, adjust that one string to match it and say so in the commit.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/backlog.test.js`
Expected: FAIL, cannot resolve `./backlog`.

- [ ] **Step 3: Implement** `backlogLines` and `appendToBacklog` in `src/backlog.js`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/backlog.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backlog.js src/backlog.test.js
git commit -m "Add backlog note content for parked todos"
```

---

### Task 6: End-to-end flow with decisions

**Files:**

- Modify: `src/rollover-flow.test.js`

**Interfaces:**

- Consumes: everything from Tasks 1–5. This pins the **order** `index.js` must follow (Task 8): `getSections` → `toItems` → decisions → `applyDecisions` → dedupe (optional) → `bumpRolledCounts` (if tracking) → `insertSections`; backlog via `appendToBacklog`; previous note: `markCancelled` **first**, then `applySourceAction` with `rolledLineIndices: movedLineIndices`, `deletedLineIndices: deleteLineIndices`, `skippedLineIndices` from `applyDecisions`.

- [ ] **Step 1: Add a `reviewedRollover({ yesterday, today = "", action, decisions, track, skipCompleted = true })` helper** next to the existing `rollover()` helper, composing the calls in the order above (children on, `skipCompletedChildren` from `skipCompleted`), returning `{ today, yesterday, backlog }` (backlog content starting from `""`, heading `""`, source name `"2026-11-06"`).

- [ ] **Step 2: Write the tests**

```js
const yesterday = [
  "# Work",
  "",
  "- [ ] Ship [rolled:: 2]",
  "  - [x] Changelog",
  "  - [ ] Tag",
  "- [ ] Old idea",
  "- [ ] Call Sam",
  "",
  "## Home",
  "",
  "- [ ] Laundry",
].join("\n");
const decisions = {
  "0:0": "roll",
  "0:2": "backlog",
  "0:3": "cancel",
  "1:0": "leave",
};

test("delete: rolled and backlogged lines go, cancelled is marked, left stays", () => {
  const r = reviewedRollover({
    yesterday,
    action: "delete",
    decisions,
    track: true,
  });
  expect(r.yesterday).toBe(
    ["# Work", "", "- [-] Call Sam", "", "## Home", "", "- [ ] Laundry"].join(
      "\n",
    ),
  );
  expect(r.today).toContain("- [ ] Ship [rolled:: 3]");
  expect(r.today).not.toContain("Old idea");
  expect(r.today).not.toContain("Laundry");
  expect(r.backlog).toBe("- [ ] Old idea [from:: [[2026-11-06]]]");
});

test("none: only the cancelled line changes in the previous note", () => {
  const r = reviewedRollover({
    yesterday,
    action: "none",
    decisions,
    track: true,
  });
  expect(r.yesterday).toBe(
    yesterday.replace("- [ ] Call Sam", "- [-] Call Sam"),
  );
});

test("all roll and no tracking matches the existing flow exactly", () => {
  const all = { "0:0": "roll", "0:2": "roll", "0:3": "roll", "1:0": "roll" };
  // the existing helper does not pass skippedLineIndices, so compare without skipping
  const r = reviewedRollover({
    yesterday,
    action: "delete",
    decisions: all,
    track: false,
    skipCompleted: false,
  });
  const old = rollover({ yesterday, action: "delete" });
  expect(r.today).toBe(old.today);
  expect(r.yesterday).toBe(old.yesterday);
});
```

(Item ids: section 0 has Ship (with 2 child lines; the completed child is skipped, so `incompleteTodos` is `[Ship, Tag, Old idea, Call Sam]` and ids are `0:0`, `0:2`, `0:3`). If the fixture's ids differ when run, fix the fixture's decision keys, not the code, and keep the intent of each test. The backlog string must match whatever exact separator Task 5 settled on.)

- [ ] **Step 3: Run**

Run: `pnpm vitest run src/rollover-flow.test.js`
Expected: PASS. A failure here means a Task 1–5 module disagrees with the spec; fix the module and add a unit test there for the case.

- [ ] **Step 4: Commit**

```bash
git add src/rollover-flow.test.js
git commit -m "Test the reviewed rollover flow end to end"
```

---

### Task 7: Settings defaults and settings tab

**Files:**

- Modify: `src/index.js` (`loadSettings` defaults only)
- Modify: `src/ui/RolloverSettingTab.js`

**Interfaces:**

- Produces: `this.plugin.settings` keys from Global Constraints.

- [ ] **Step 1: Add the seven defaults** to `DEFAULT_SETTINGS` in `loadSettings()`.

- [ ] **Step 2: Add two groups at the end of `display()`**, each starting with `new Setting(this.containerEl).setName(<title>).setHeading()`:

  - **Review**
    - "Review automatic rollovers" — dropdown `reviewOnAutoRollover`: `off` "Never", `stale` "Only when a todo is stale", `always` "Always". Description says the "Review and roll over todos" command always shows the review, and closing the review skips that rollover.
    - "Cancel marker" — text `cancelMarker`, placeholder `-`, stored as typed; description says it must be one character, falls back to `-`, and that Cancel is offered in the review only when this character is one of the done status markers. When `!isCancelAvailable(settings)`, say so in the description so the user knows why Cancel is missing.
  - **Aging**
    - "Count rollovers" — toggle `trackRolloverCount`; description shows the `[rolled:: 3]` example and says the counter is added to each rolled todo's text. On change, save and call `this.display()` so the controls below update.
    - "Stale after" — text `staleAfterRollovers` (parse with `parseInt`, ignore non-numbers, `0` disables); `setDisabled(!trackRolloverCount)`.
    - "When a todo is stale" — dropdown `staleBehavior`: `keep` "Keep rolling it", `backlog` "Move it to the backlog"; description says this applies when no review is shown. Disabled while tracking is off.
    - "Backlog note" — text `backlogNotePath`, placeholder `Backlog.md`; empty disables the Backlog choice.
    - "Backlog heading" — text `backlogHeading`, placeholder `## Someday`; empty means end of note.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: exits 0, `main.js` written.

- [ ] **Step 4: Run all tests**

Run: `pnpm vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.js src/ui/RolloverSettingTab.js
git commit -m "Add review and aging settings"
```

---

### Task 8: Review dialog and rollover wiring

**Files:**

- Create: `src/ui/ReviewModal.js`
- Modify: `src/index.js` (`rollover`, `onload`)
- Modify: `src/ui/UndoModal.js`

**Interfaces:**

- Consumes: Tasks 1–5 (including `isCancelAvailable` from Task 4), settings from Task 7.
- Produces:

  - `class ReviewModal extends Modal` with `constructor(app, { sourceName, sections, items, decisions, staleSettings, backlogEnabled, cancelEnabled })` and `openAndWait(): Promise<Record<string, Outcome> | null>`. Resolves with the decisions on Apply; with `null` on Cancel, Escape or any other close. Resolves exactly once.
  - `rollover(file = undefined, { review = false } = {})`.
  - Undo entry gains `backlog: { file, oldContent, created }`.

- [ ] **Step 1: Write `ReviewModal`.** Layout per spec "The dialog": title `Roll over from <sourceName>`; one block per section with `headingLabel` and "All roll" / "All leave" buttons; one `Setting` row per item with `setName(itemLabel(item))`, a `rolled N×` badge (`createSpan({ cls: "rollover-stale-badge", text })`) when `isStale`, and a dropdown of outcomes (`roll` "Roll", `backlog` "Backlog" only when `backlogEnabled`, `cancel` "Cancel" only when `cancelEnabled`, `leave` "Leave"); global "All roll" / "All leave"; a summary line updated from `summarizeDecisions` on every change; footer Apply (`setCta()`) and Cancel. Work on a copy of `decisions`. Badge styling: add a `styles.css` only if needed, using `var(--text-warning)` and `var(--font-ui-smaller)`; if added, it must ship in releases next to `main.js`.

- [ ] **Step 2: Wire the stage into `rollover()`.** After `dropEmptyTodos` and before reading today's note:

  1. `const items = toItems(sections_today, rolloverChildren)`; staleness settings from `this.settings`; `backlogEnabled = backlogNotePath.trim() !== ""`; `cancelEnabled = isCancelAvailable(this.settings)`.
  2. Resolve the backlog path with `normalizePath`, adding `.md` if missing. If it equals `file.path` or `lastDailyNote.path`, show a notice ("The backlog note can't be today's or the previous daily note. Change it in settings.") and return before any write.
  3. `let decisions = defaultDecisions(items, …)`. Show the dialog when `review` is true, or when this is an automatic run (`file` was passed) and `needsReview(reviewOnAutoRollover, items, …)`. A `null` result returns with nothing written; for automatic runs show "Rollover skipped. Run 'Review and roll over todos' when you're ready."
  4. `applyDecisions(...)` with `foundLineIndices`. Replace `sections_today` with its `sections` for the rest of the function. Read today's note only now.
  5. When `trackRolloverCount`, run `bumpRolledCounts` on the sections to insert, **after** dedupe and before `insertSections`.
  6. After inserting into today's note (and after the Templater check, which must also return before the backlog write when it fails), append backlog items: `getAbstractFileByPath`; if missing, create the parent folder when it does not exist (`vault.createFolder`) and `vault.create(path, appendToBacklog({ content: "", … }))` with `created: true`; else `vault.process`. Snapshot `oldContent` for undo. If this throws, show a notice naming the failure, keep the undo entry for what was written, and return without touching the previous note.
  7. In the existing `vault.process` on the previous note: `markCancelled` first (with `normalizeMarker(cancelMarker, "-")`), then `applySourceAction` with `rolledLineIndices: movedLineIndices`, `deletedLineIndices: deleteLineIndices`, `skippedLineIndices` from step 4. Keep the "edited meanwhile" check exactly as is. Run this block when `sourceAction !== "none"` **or** there are cancelled lines.
  8. Extend the notice with `- N moved to backlog.`, `- N cancelled.`, `- N left in <previous note>.` (each only when N > 0; counts are items, not lines).
  9. Keep the undo-history rule: record history when any of today / previous / backlog was written.

- [ ] **Step 3: Register the command** in `onload`: id `review-and-rollover`, name `Review and roll over todos…`, callback `this.rollover(undefined, { review: true })`.

- [ ] **Step 4: Update `UndoModal`.** In `onOpen`, list the backlog entry with `parseDay` (or "will be deleted" when `created`). In `confirmUndo`, a created backlog note is removed with `app.fileManager.trashFile(file)`; otherwise restore `oldContent` with `vault.modify`, as for the other two files.

- [ ] **Step 5: Build and test**

Run: `pnpm build && pnpm vitest run`
Expected: build exits 0; all tests PASS.

- [ ] **Step 6: Manual check in `/home/lyndonw/data/obsidian-stuff/test-vault`** (copy `main.js`, `manifest.json` and any `styles.css` into its plugin folder, reload Obsidian). Each line is one check; note pass/fail in the commit body:

  1. All new settings at defaults, automatic rollover: today's and previous notes identical to the previous build's output.
  2. Review command with Roll / Backlog / Cancel / Leave on four todos and "after rollover: delete": matches the Task 6 expectations; backlog note created in a missing folder.
  3. Escape in the dialog: no file changes, no notice for the command, skip notice for an automatic run.
  4. Counting on, stale after 2, review "only when stale": third rollover of the same todo opens the dialog with the badge.
  5. Undo after (2): all three files restored, created backlog note moved to trash.
  6. Backlog path set to today's note path: notice, nothing changes.
  7. Narrow the window to phone width (or use the mobile emulation command): dialog rows wrap, no horizontal scroll.

- [ ] **Step 7: Commit**

```bash
git add src/ui/ReviewModal.js src/index.js src/ui/UndoModal.js
git commit -m "Add the review dialog and wire review and aging into rollover"
```

(Include `styles.css` if created.)

---

### Task 9: Documentation

**Files:**

- Modify: `README.md` (Usage and Settings sections)
- Modify: `CLAUDE.md` (Core files, Plugin settings, Testing)

- [ ] **Step 1: README.** Add a usage section for "Review and roll over todos…" with the four outcomes table from the spec, and settings entries for Review and Aging, including the `[rolled:: n]` example and the note that the counter goes before Tasks fields. State that mark-as-moved and skip-existing originate from upstream's `release/v1.3.0` wherever the README describes what is distinct about this plugin.

- [ ] **Step 2: CLAUDE.md.** Add `src/rolled-count.js`, `src/rollover-items.js`, `src/backlog.js`, `src/ui/ReviewModal.js` to Core files; the seven settings to Plugin settings; the three new test files to Testing; the new stage to Rollover flow.

- [ ] **Step 3: Format and verify**

Run: `pnpm format && pnpm vitest run && pnpm build`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "Document review and aging"
```
