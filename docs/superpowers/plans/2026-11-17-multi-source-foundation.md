# Multi-source Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rollover works on a list of source notes (holding only the previous daily note), with no change in behaviour, so later Phase 3 items can add sources.

**Architecture:** Each source runs the existing pure steps (`planDecisions()`, `applyPlan()`, `planInsert()`) on its own line positions. A new pure module, `src/rollover-sources.js`, loops over sources and merges them only where they meet: one decisions map, one write of today's note (sources inserted one after another), one backlog write, one notice. `src/index.js` builds the source list and writes each source note separately; undo and the review dialog take lists.

**Tech Stack:** Plain JavaScript ES modules, Obsidian API, rollup, vitest, the e2e suite in `e2e/` (Obsidian CLI). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-multi-source-foundation-design.md`

## Global Constraints

- No visible change: today's note, the previous note, the backlog note, every notice, the review dialog and undo behave exactly as on `main`. No expected output in an existing unit test or e2e test changes; only how tests call the code may change.
- Never regenerate `e2e/fixtures/expected/` (`E2E_UPDATE_EXPECTED=1`). If `e2e/baseline.e2e.js` fails, the refactor is wrong.
- The previous daily note's source has `key: ""`, so its item ids stay `${sectionIndex}:${start}`.
- Pure modules keep their signatures; additions are optional parameters with defaults that reproduce today's behaviour.
- New logic goes in pure modules with unit tests, not in `src/index.js` or `src/ui/`.
- Commit messages: plain imperative subject, no `Co-Authored-By` or `Claude-Session` lines.
- Run prettier only on files a task creates, never repo-wide (several existing files are not prettier-clean on `main`).
- `pnpm build` must exit 0 after any task touching `src/index.js` or `src/ui/`. Unit tests: `pnpm test` or `pnpm test -- <file>`. e2e: `pnpm test:e2e` (needs Obsidian running with the `e2e-vault` vault open; if it is not, stop and ask the user to open it).

## Review Focus

1. **A rollover where every item is Leave** (nothing reaches today's note): today's note is not written, the notice is only the "left in" line, undo records only the previous note when Cancel changed it. Covered by the notice tests in Task 3 and `e2e/outcomes.e2e.js`.
2. **The previous note edited during the Templater wait**: left unchanged, with today's notice text. Covered by `e2e/guards.e2e.js`; Task 5 must keep the exact text.
3. **Backlog write failing**: no source note is touched and undo still records today's note. Task 5 keeps the order today → backlog → sources.
4. **Two sources containing the same todo text with skip existing off**: both copies are inserted (only skip existing dedupes). Test in Task 2.
5. **Item ids colliding across sources**: the second source's ids carry its prefix. Test in Task 2.

---

## Setup

- [ ] Create branch `feat/multi-source` from `main` (the spec and this plan are on `main`).

---

### Task 1: Id prefix and per-item backlog source

**Files:**
- Modify: `src/rollover-items.js` (`toItems()`), `src/rollover-plan.js` (`planDecisions()`), `src/backlog.js` (`backlogLines()`)
- Test: `src/rollover-items.test.js`, `src/backlog.test.js`

**Interfaces:**
- Produces:
  - `toItems(sections, withChildren, idPrefix = "")`: ids become `` `${idPrefix}${sectionIndex}:${start}` ``.
  - `planDecisions({ sections, lines, settings, idPrefix = "" })`: passes `idPrefix` to `toItems()`; the returned plan also carries `idPrefix`.
  - `backlogLines(items, sourceNoteName)`: an item with a `sourceName` string uses it in `[from:: [[…]]]`; otherwise `sourceNoteName`.

- [ ] **Step 1: Write the failing tests**

In `src/rollover-items.test.js`:

```js
test("item ids carry the prefix", () => {
  const ids = toItems(sections, true, "inbox/").map((item) => item.id);
  expect(ids.every((id) => id.startsWith("inbox/"))).toBe(true);
  expect(toItems(sections, true).map((item) => item.id)[0]).toBe("0:0");
});
```

In `src/backlog.test.js`:

```js
test("an item's own source name wins", () => {
  const lines = backlogLines(
    [{ lines: ["- [ ] a"], sourceName: "Inbox" }, { lines: ["- [ ] b"] }],
    "2026-11-16"
  );
  expect(lines).toEqual([
    "- [ ] a [from:: [[Inbox]]]",
    "- [ ] b [from:: [[2026-11-16]]]",
  ]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test -- src/rollover-items.test.js src/backlog.test.js`
Expected: the two new tests FAIL.

- [ ] **Step 3: Implement the three changes above**

- [ ] **Step 4: Run all unit tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/rollover-items.js src/rollover-plan.js src/backlog.js src/rollover-items.test.js src/backlog.test.js
git commit -m "Let item ids carry a source prefix and backlog items name their source"
```

---

### Task 2: The sources module

**Files:**
- Create: `src/rollover-sources.js`
- Test: `src/rollover-sources.test.js`

**Interfaces:**
- Consumes: `planDecisions({ sections, lines, settings, idPrefix })`, `applyPlan({ plan, decisions })`, `planInsert({ sections, todayContent, settings, noStaleLineIndices, lines })` from `src/rollover-plan.js`; `insertSections({ content, sections, templateHeading, leadingNewLine })` from `src/insert-sections.js`.
- Produces (a source is `{ key, kind, name, lines, sections, sourceAction }`, plus `file` and `content` in `index.js`):
  - `planSources({ sources, settings }) → { plans, items, decisions }`. `settings` is what `planDecisions()` takes. `plans[i]` is `planDecisions()` for `sources[i]` with `idPrefix: sources[i].key ?? ""`. `items` is all plans' items in source order. `decisions` merges all plans' default decisions.
  - `applySources({ plans, sources, decisions }) → { perSource, backlogItems, outcomeCounts }`. `perSource[i]` is `applyPlan({ plan: plans[i], decisions })`. `backlogItems` is every source's backlog items in order, each copied with `sourceName: sources[i].name`. `outcomeCounts` sums `perSource[i].outcomeCounts` per outcome (`roll`, `backlog`, `cancel`, `leave`).
  - `insertSources({ content, entries, settings }) → { content, templateHeadingNotFound, perSource }`. `entries[i]` is `{ sections, lines, noStaleLineIndices }` (the rolled sections of source i, `sources[i].lines`, `perSource[i].noStaleLineIndices`). `settings` is `{ skipExistingTodos, rolloverChildren, trackRolloverCount, doneStatusMarkers, templateHeading, leadingNewLine }`. For each entry in order: `planInsert()` against the current content, then `insertSections()` with its result, and the new content goes to the next entry. `perSource[i]` is `{ todosAlreadyPresent, duplicateTodos, retainedLineIndices, insertedTodos }` (`insertedTodos`: the inserted sections' `incompleteTodos`, flattened). `templateHeadingNotFound` is true when any insert reported it. An entry with no sections is skipped.

- [ ] **Step 1: Write the failing tests**

Two sources for every test:

```js
const previous = source("", "2026-11-16", ["## Work", "- [ ] Ship", "- [ ] Call"]);
const inbox = source("inbox/", "Inbox", ["- [ ] Call", "- [ ] Buy milk"]);
```

where `source(key, name, lines)` returns `{ key, kind: key ? "inbox" : "previous", name, lines, sections: getSections({ lines, withChildren: true, doneStatusMarkers: "xX-" }), sourceAction: "delete" }`, and the plan settings are `{ removeEmptyTodos: false, rolloverChildren: true, trackRolloverCount: false, staleAfterRollovers: 5, staleBehavior: "keep", backlogEnabled: true, cancelEnabled: true, rules: [] }`.

Tests:

- `"ids are unique across sources and decisions cover every item"`: `items.map((i) => i.id)` equals `["0:0", "0:1", "inbox/0:0", "inbox/0:1"]`; `Object.keys(decisions)` has the same four ids.
- `"backlog items carry their source's name, and counts add up"`: decide `0:1` → `"backlog"`, `inbox/0:1` → `"backlog"`, `inbox/0:0` → `"leave"`, the rest roll. `backlogItems.map((i) => i.sourceName)` equals `["2026-11-16", "Inbox"]`; `outcomeCounts` equals `{ roll: 1, backlog: 2, cancel: 0, leave: 1 }`.
- `"a later source is deduped against what an earlier one inserted"`: all roll, `insertSources()` into `""` with `skipExistingTodos: true`, `templateHeading: "none"`, `leadingNewLine: true`. The result has exactly one line `"- [ ] Call"` and one `"- [ ] Buy milk"`; `perSource[1].todosAlreadyPresent` is 1; `perSource[1].retainedLineIndices` equals `[0]`.
- `"without skip existing both copies are inserted"`: same with `skipExistingTodos: false`: two `"- [ ] Call"` lines.
- `"a source with nothing to insert is skipped"`: everything in the inbox decided `"leave"`: `perSource[1]` is `{ todosAlreadyPresent: 0, duplicateTodos: [], retainedLineIndices: [], insertedTodos: [] }`, and the content equals inserting the previous note alone.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test -- src/rollover-sources.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `planSources`, `applySources`, `insertSources` in `src/rollover-sources.js`**

Start the file with a comment saying what it is for (the Obsidian-free orchestration over several source notes, shared by `index.js` and `rollover-flow.test.js`), in the style of `src/rollover-plan.js`.

- [ ] **Step 4: Run the tests**

Run: `pnpm test -- src/rollover-sources.test.js`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
pnpm exec prettier --write src/rollover-sources.js src/rollover-sources.test.js
git add src/rollover-sources.js src/rollover-sources.test.js
git commit -m "Add the pure orchestration for rollovers from several notes"
```

---

### Task 3: The notice as a pure function

**Files:**
- Modify: `src/rollover-sources.js`
- Test: `src/rollover-sources.test.js`

**Interfaces:**
- Produces: `rolloverNotice({ templateHeadingNotFound, templateHeading, todosAdded, todosAlreadyPresent, backlogCount, backlogPath, cancelledCount, sources }) → string`, where `sources[i]` is `{ name, sourceAction, removedEmptyTodos, leftCount }`. Reproduces the notice assembled in `rolloverDailyNote()` (`src/index.js`, from `// Let user know rollover has been successful` to `const message = nonBlankLines.join("\n")`) character for character, including the trailing space after the rolled and empty-todo lines. Per source: its empty-todos line only when its `sourceAction` is `"delete"`, its `- N left in {name}.` line only when `leftCount > 0`. The caller passes `cancelledCount` as 0 when the cancel marks were not applied. Returns `""` when there is nothing to say.

- [ ] **Step 1: Write the failing tests**

With one source `{ name: "2026-11-16", sourceAction: "delete", removedEmptyTodos: 0, leftCount: 0 }` unless a test says otherwise:

- `"rolled todos"`: `todosAdded: 3` → `"- 3 todos rolled over. "`; `todosAdded: 1` → `"- 1 todo rolled over. "`.
- `"every line, in order"`: `templateHeadingNotFound: true, templateHeading: "## Tasks", todosAdded: 2, todosAlreadyPresent: 1, backlogCount: 1, backlogPath: "Backlog.md", cancelledCount: 1`, the source with `removedEmptyTodos: 2, leftCount: 1` →

```js
[
  "Rollover couldn't find '## Tasks' in today's daily note. Rolling todos to end of file.",
  "- 2 todos rolled over. ",
  "- 2 empty todos removed. ",
  "- 1 line skipped (already in today's note).",
  "- 1 moved to backlog (Backlog.md).",
  "- 1 cancelled.",
  "- 1 left in 2026-11-16.",
].join("\n")
```

- `"empty todos are only reported when they were deleted"`: the source with `sourceAction: "mark", removedEmptyTodos: 2` and nothing else → `""`.
- `"nothing to say"`: all zero → `""`.

Before writing the expected strings, read the current assembly in `src/index.js` and correct any expectation above that does not match it character for character: the current text wins.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test -- src/rollover-sources.test.js -t "notice"`
Expected: FAIL.

- [ ] **Step 3: Implement `rolloverNotice`** by moving the string building out of `index.js` (not wired up yet; Task 5 does that).

- [ ] **Step 4: Run the tests**

Run: `pnpm test -- src/rollover-sources.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rollover-sources.js src/rollover-sources.test.js
git commit -m "Build the rollover notice in a pure function"
```

---

### Task 4: Flow tests through the sources module

**Files:**
- Modify: `src/rollover-flow.test.js` (the `reviewedRollover()` helper only)

**Interfaces:**
- Consumes: `planSources`, `applySources`, `insertSources` (Task 2).

- [ ] **Step 1: Rewrite `reviewedRollover()`** to build one source (`key: ""`, `kind: "previous"`, `name: "2026-11-06"`, the parsed `lines` and `sections`, `sourceAction: action`) and run it the way Task 5's `index.js` will: `planSources()` → `applySources()` (with `decisions ?? plan decisions`) → `insertSources()` → `appendToBacklog()` with the tagged `backlogItems` → `markCancelled()` then `applySourceAction()` on the source with `perSource[0]`'s line positions and `insertSources()`'s `perSource[0].retainedLineIndices`. Keep its parameters and its return value (`today`, `yesterday`, `backlog`, `items`) as they are. Do not touch the older `rollover()` helper or any test body.

- [ ] **Step 2: Run the flow tests**

Run: `pnpm test -- src/rollover-flow.test.js`
Expected: every test passes, with no expectation edited. A failure means the module differs from the old path: fix the module, not the test.

- [ ] **Step 3: Commit**

```bash
git add src/rollover-flow.test.js
git commit -m "Run the reviewed flow tests through the sources module"
```

---

### Task 5: index.js, undo and the review dialog on sources

**Files:**
- Modify: `src/index.js` (`rolloverDailyNote()`, `recordUndo()`), `src/ui/UndoModal.js`, `src/ui/ReviewModal.js`, `CLAUDE.md`, `docs/roadmap.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - Undo entry: `{ today, backlog, sources: [{ file, oldContent }] }` (replaces `previousDay`). `recordUndo()` keeps it when `today.file`, `backlog.file` or any `sources` entry is set.
  - `new ReviewModal(app, { sources: [{ name, sections, items }], decisions, staleSettings, backlogEnabled, cancelEnabled })` (replaces `sourceName`, `sections`, `items`). With one source it renders exactly what it renders today. With more than one it renders each source's sections in turn under the one title (the inbox plan designs the real layout).

- [ ] **Step 1: Rework `rolloverDailyNote()`**

In order, keeping every notice text and every early return as it is:
1. Build `sources`: the previous daily note as `{ key: "", kind: "previous", name: lastDailyNote.basename, file: lastDailyNote, content, lines, sections, sourceAction: resolveSourceAction(this.settings) }`, dropped when it has no open todos; return when `sources` is empty.
2. `planSources()`. The backlog guard refuses a backlog path equal to today's note or any source's file path (same notice text).
3. Review dialog as now, with `sources` mapped to `{ name, sections: plans[i].sections, items: plans[i].items }`; `needsReview()` gets all items.
4. `applySources()`.
5. Today's note: inside the existing `vault.process(file, …)`, `insertSources()` with one entry per source. Todo counts: `todosAdded` = sum of `perSource[i].rolledTodoCount` minus the summed `todosAlreadyPresent`.
6. Templater safeguard: runs when any source's `sourceAction !== "none"` (and there were inserted or duplicate todos), with all sources' `insertedTodos` and `duplicateTodos`.
7. Backlog: `writeBacklog(backlogPath, backlogItems, sources[0].name)`, once, as now.
8. For each source in order: the existing "Cancel marks and source action" block, on that source's file, content, `perSource[i]` and `insertSources().perSource[i].retainedLineIndices`; a changed source pushes `{ file, oldContent }` onto `undoHistoryInstance.sources`. The "edited while the rollover was running" notice keeps today's text.
9. `rolloverNotice()` replaces the inline assembly; the notice duration stays `4000 + message.length * 3`.

- [ ] **Step 2: Undo**: `recordUndo()` and `UndoModal` (`confirmUndo()` restores each `sources` entry; `onOpen()` lists each with `parseDay()`, keeping today's wording when there is exactly one).

- [ ] **Step 3: Review dialog**: the constructor change above; the title stays `Roll over from {name}` for one source.

- [ ] **Step 4: Build and run the unit tests**

Run: `pnpm build && pnpm test`
Expected: build exits 0; all tests pass.

- [ ] **Step 5: Run the full e2e suite**

Run: `pnpm test:e2e`
Expected: every file passes, including `baseline.e2e.js`, `outcomes.e2e.js`, `guards.e2e.js`, `rules.e2e.js` and `aging.e2e.js`, with no fixture or expectation changed.

- [ ] **Step 6: Docs**

`CLAUDE.md`: add `src/rollover-sources.js` to the core files (what each export does), describe the source object and the undo entry's `sources` list, and update the **Rollover flow** paragraph (sources planned per note, inserted in turn, written one by one). `docs/roadmap.md`: tick "Multi-source foundation".

- [ ] **Step 7: Commit**

```bash
git add src/index.js src/ui/UndoModal.js src/ui/ReviewModal.js CLAUDE.md docs/roadmap.md
git commit -m "Run the rollover over a list of source notes"
```
