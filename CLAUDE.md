# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # watch mode build (dev)
pnpm build        # production build → main.js
pnpm test         # run all tests (vitest)
pnpm test -- --reporter=verbose   # run tests with details
pnpm format       # prettier format
```

Run a single test by name:

```bash
pnpm test -- -t "single todo element"
```

## Architecture

This is an [Obsidian](https://obsidian.md) plugin. Obsidian plugins must ship as a CommonJS bundle at `main.js` (built by rollup from `src/index.js`). The `obsidian` import is external (provided by Obsidian at runtime).

**Core files:**

- `src/index.js` — `RolloverTodosPlugin` class (extends `Plugin`). Handles plugin lifecycle (`onload`), vault event registration, commands ("Roll over todos now", "Undo last rollover"), and the top-level `rollover()` orchestration logic.
- `src/get-todos.js` — `TodoParser` class + `getTodos()` / `getTodosAndSkipped()` exports, plus the section helpers `getSections()` (todos grouped by full heading ancestry), `removeEmptiedHeadings()` (drops the headings a deletion emptied, not ones that were already empty), `hasHeading()` and `insertUnderHeading()`. Pure logic on arrays of markdown lines. Uses `Intl.Segmenter` for correct Unicode grapheme cluster handling (emoji, combining characters in checkbox content).
- `src/source-action.js` — pure `applySourceAction()` for what happens to the previous day's note after rollover (`none` / `delete` / `mark`), acting on line positions from `getSections()` (`incompleteLineIndices`, `skippedLineIndices`), never on line text, plus settings helpers (`resolveSourceAction`, `migrateSourceActionSettings`, `normalizeMarker`, `effectiveDoneStatusMarkers`), `markCancelled()` (the Cancel outcome's checkbox change) and `isCancelAvailable()` (Cancel is offered only when the cancel marker is a done marker).
- `src/insert-sections.js` — pure `insertSections()`: puts each section's todos into today's note under the template heading, or under the headings they had in the previous note when there is none, reusing existing headings and creating missing ones.
- `src/insert-todos.js` — pure `dedupeAgainstExisting()` (skip todos already in today's note), `verifyTodosPresent()` (Templater safeguard) and `dropEmptyTodos()` (with `recordDropped`, a section also carries `droppedLineIndices` / `droppedTodos`, the empty todos dropped from it).
- `src/rolled-count.js` — pure helpers for the inline `[rolled:: n]` counter: `parseRolledCount`, `setRolledCount`, `stripRolledCount`, and `insertField` (also used for `[from:: …]`). A field goes before the first Obsidian Tasks emoji field (so Tasks still reads its fields from the end of the line), else before a trailing block id, else at the end.
- `src/rollover-items.js` — pure review logic: `toItems()` groups a section's todos into items (a todo plus nested lines; skipped completed children and dropped empty todos indented under the head do not split an item), `isStale()`, `defaultDecisions()`, `needsReview()`, `countOutcomes()`, `applyDecisions()` (turns decisions into sections to insert, backlog items and the line indices to move, cancel and delete), `bumpRolledCounts()`, `skippedLinesToDelete()`, and label/summary helpers for the dialog. A skipped or dropped line belongs to the item holding the nearest line above it that is indented less (walking up through skipped and dropped lines, never past a line the parser did not find), or to no item; delete removes it unless it belongs to a Cancel or Leave item. Outcomes are `"roll"`, `"backlog"`, `"cancel"`, `"leave"`.
- `src/rollover-plan.js` — the Obsidian-free decision stage of `rollover()`, shared by `index.js` and `rollover-flow.test.js`: `planDecisions()` (drop empty todos, `toItems()`, default decisions), `applyPlan()` (`applyDecisions()`, `skippedLinesToDelete()`, outcome counts) and `planInsert()` (dedupe against today's note, `bumpRolledCounts()`).
- `src/backlog.js` — pure `appendToBacklog()` / `backlogLines()`: adds parked items to the backlog note's content under a heading (created when missing) or at the end, with the counter stripped and `[from:: [[source note]]]` added.
- `src/template-headings.js` — pure helpers for the template heading setting (`extractHeadings`, `headingOptions`).
- `src/settings-dependencies.js` — pure `dependentSettingStates()`: for each dependent setting (`DEPENDENT_SETTINGS`), whether it applies and, if not, the reason shown in place of its description; plus `cancelMarkerNote()`.
- `src/settings-text.js` — the settings tab's text: `SETTING_GROUPS` (six groups with their `?` help, `**bold**` markup split by `helpSegments()`), `SETTING_LABELS` and the one-line `SETTING_DESCRIPTIONS`.
- `src/ui/RolloverSettingTab.js` — Obsidian `PluginSettingTab` for the settings panel: renders the six groups from `settings-text.js`, with dependent settings indented under their parent and a `?` help panel per group. After every change `refreshDependents()` greys out the settings that don't apply (from `settings-dependencies.js`) in place, so the page never re-renders or jumps.
- `src/ui/UndoModal.js` — Obsidian `Modal` for the undo confirmation dialog (also restores or deletes the backlog note). Restores notes with `vault.process()`.
- `src/ui/ReviewModal.js` — Obsidian `Modal` for the review dialog: one dropdown per item, section and global shortcuts, a live summary. `openAndWait()` resolves with the decisions on Apply and `null` otherwise. UI only; logic lives in `rollover-items.js`.
- `styles.css` — styles for the review dialog and the settings tab's indented dependents and help panels (theme CSS variables only, wraps at phone width). Shipped with the release next to `main.js` and `manifest.json`.

**Plugin settings** (defaults in `loadSettings`):

- `templateHeading` — heading to insert todos under (or `"none"` for end of file)
- `onRolloverSourceAction` — `"none"` (default), `"delete"` or `"mark"`: what to do with rolled todos on the previous day's note (replaces the old `deleteOnComplete` boolean, which is migrated to `"delete"`)
- `rolloverSourceMarker` — checkbox character used by `"mark"` (default `">"`); counts as a done marker while marking, without changing `doneStatusMarkers`
- `moveNestedItemsOnMark` — with `"mark"` and `rolloverChildren`, keep only the marked todo in the previous day's note and remove the rolled items nested under it (they moved to today's note); completed children stay when `skipCompletedChildren` is on
- `skipExistingTodos` — don't roll over todos (with their children) that today's note already has
- `ignoreBlockquotes` — don't roll over todos inside blockquotes/callouts
- `skipCompletedChildren` — with `rolloverChildren`, leave completed child todos out (removed with their parent when deleting)
- `removeEmptyTodos` — skip empty `- [ ]` items
- `rolloverChildren` — include indented child items under a todo
- `rolloverOnFileCreate` — auto-trigger on vault `create` event
- `doneStatusMarkers` — string of characters treated as "done" (default `"xX-"`)
- `reviewOnAutoRollover` — `"off"` (default), `"stale"` or `"always"`: whether an automatic rollover opens the review dialog (the "Review and roll over todos…" command always does)
- `cancelMarker` — checkbox character for the Cancel outcome (default `"-"`); Cancel is offered only when it is one of the done markers (`isCancelAvailable`), and `effectiveDoneStatusMarkers` is not changed for it
- `trackRolloverCount` — default `false`: write `[rolled:: n]` on each rolled todo, raised by 1 per rollover
- `staleAfterRollovers` — default `5`: a todo is stale once its count is at least this (0 disables); only used with `trackRolloverCount`
- `staleBehavior` — `"keep"` (default) or `"backlog"`: default outcome of stale todos, and what happens to them when no review is shown (needs a backlog note)
- `backlogNotePath` — default `""`: note that receives Backlog items; empty disables the Backlog outcome. Cannot be today's or the previous note
- `backlogHeading` — default `""`: heading in the backlog note to add items under (empty = end of note); text that does not match `/^#{1,6}\s/` gets a `## ` prefix
- `leadingNewLine` — blank line between a heading and the first todos inserted under it, and before a heading the rollover adds; todos added to an existing list continue it without one

**Rollover flow:** On daily note creation (or a command), `rollover()` validates the file is today's daily note (created within 5 seconds); while another rollover is still running (`rolloverInProgress`, e.g. its dialog is open) an automatic run returns silently and a command shows a notice. `rolloverDailyNote()` then finds the previous daily note via `getLastDailyNote()`, and groups its unfinished todos by heading with `getSections()`. Review stage (`planDecisions()`): empty todos are dropped with `removeEmptyTodos`, `toItems()` groups the todos into items, `defaultDecisions()` picks an outcome per item (Roll, except stale items under `staleBehavior: "backlog"` when a backlog note is set), and `ReviewModal` lets the user change them when the "Review and roll over todos…" command was used or `needsReview()` says so for an automatic run. It only opens when there are items, and closing it abandons the rollover with nothing written. `applyPlan()` (`applyDecisions()`) turns the decisions into the sections to insert (Roll items only), the items for the backlog, and the line positions to cancel, delete or leave. Today's note is read after the review, in the same `vault.process()` that writes it, so planning and writing see the same content. The Roll sections are inserted with `insertSections()` (under the template heading, or under their own recreated headings when there is none), optionally skipping todos today's note already has, with `[rolled:: n]` raised by `bumpRolledCounts()` when `trackRolloverCount` is on (both in `planInsert()`). Backlog items are then appended with `appendToBacklog()` (the note and its folder are created when missing; if the write fails the previous note is left untouched). Last, the previous day's note changes in one `vault.process()`: Cancel items are marked first with `markCancelled()` (never deleted), then the configured source action (`delete` / `mark`) runs on Roll and Backlog items only. Both use the line positions of the note as it was parsed, which stay valid because marking only rewrites checkboxes. Leave items are untouched. If Templater is enabled and the action is destructive, it first waits 3 seconds and checks that the inserted todos survived. Undo history is kept for 2 minutes and also snapshots the backlog note (undo deletes it when the rollover created it); with Templater enabled only the previous day's note and the backlog note are snapshotted.

**Testing:** Tests (`pnpm test`) cover the pure modules: `src/get-todos.test.js`, `src/source-action.test.js`, `src/insert-todos.test.js`, `src/insert-sections.test.js`, `src/template-headings.test.js`, and `src/rolled-count.test.js`, `src/rollover-items.test.js`, `src/backlog.test.js`, `src/settings-dependencies.test.js`, `src/settings-text.test.js`, and `src/rollover-flow.test.js` (the Obsidian-free parts of `rollover()` run end to end, through the same `rollover-plan.js` calls as `index.js`). The vault/UI logic in `index.js` and `src/ui/` (including the review dialog) needs Obsidian and has no tests, so keep logic in the pure modules where it can be tested.

## Fork and upstream relationship

This is a personal fork of `git@github.com:lumoe/obsidian-rollover-daily-todos.git` (the upstream Obsidian community plugin).

**Branching strategy:**

- `main` — primary branch for this fork. Upstream's `master` changes are selectively cherry-picked here.
- `master` — tracks the upstream `master` branch (kept in sync to make cherry-picking straightforward).
- `release/v1.3.0` — upstream's WIP branch with significant behavioral changes that have not been evaluated yet. Do not merge or cherry-pick from this branch until it has been tested. Keep it around for future reference.

When pulling in upstream changes: fetch from upstream into `master`, then cherry-pick individual commits onto `main`. Avoid bulk-merging `master` → `main` to stay in control of what behavioral changes are adopted.
