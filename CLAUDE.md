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

- `src/index.js` — `RolloverTodosPlugin` class (extends `Plugin`). Handles plugin lifecycle (`onload`), vault event registration, commands ("Rollover Todos Now", "Undo last rollover"), and the top-level `rollover()` orchestration logic.
- `src/get-todos.js` — `TodoParser` class + `getTodos()` / `getTodosAndSkipped()` exports, plus the section helpers `getSections()` (todos grouped by full heading ancestry), `removeEmptyHeadings()`, `hasHeading()` and `insertUnderHeading()`. Pure logic on arrays of markdown lines. Uses `Intl.Segmenter` for correct Unicode grapheme cluster handling (emoji, combining characters in checkbox content).
- `src/source-action.js` — pure `applySourceAction()` for what happens to the previous day's note after rollover (`none` / `delete` / `mark`), acting on line positions from `getSections()` (`incompleteLineIndices`, `skippedLineIndices`), never on line text, plus settings helpers (`resolveSourceAction`, `migrateSourceActionSettings`, `normalizeMarker`, `effectiveDoneStatusMarkers`).
- `src/insert-todos.js` — pure `dedupeAgainstExisting()` (skip todos already in today's note) and `verifyTodosPresent()` (Templater safeguard).
- `src/template-headings.js` — pure helpers for the template heading setting (`extractHeadings`, `headingOptions`).
- `src/ui/RolloverSettingTab.js` — Obsidian `PluginSettingTab` for the settings panel.
- `src/ui/UndoModal.js` — Obsidian `Modal` for the undo confirmation dialog.

**Plugin settings** (defaults in `loadSettings`):

- `templateHeading` — heading to insert todos under (or `"none"` for end of file)
- `onRolloverSourceAction` — `"none"` (default), `"delete"` or `"mark"`: what to do with rolled todos on the previous day's note (replaces the old `deleteOnComplete` boolean, which is migrated to `"delete"`)
- `rolloverSourceMarker` — checkbox character used by `"mark"` (default `">"`); counts as a done marker while marking, without changing `doneStatusMarkers`
- `skipExistingTodos` — don't roll over todos (with their children) that today's note already has
- `ignoreBlockquotes` — don't roll over todos inside blockquotes/callouts
- `skipCompletedChildren` — with `rolloverChildren`, leave completed child todos out (removed with their parent when deleting)
- `removeEmptyTodos` — skip empty `- [ ]` items
- `rolloverChildren` — include indented child items under a todo
- `rolloverOnFileCreate` — auto-trigger on vault `create` event
- `doneStatusMarkers` — string of characters treated as "done" (default `"xX-"`)
- `leadingNewLine` — add a newline before todos when inserting under a heading

**Rollover flow:** On daily note creation (or manual command), `rollover()` validates the file is today's daily note (created within 5 seconds), finds the previous daily note via `getLastDailyNote()`, and groups its unfinished todos by heading with `getSections()`. It inserts them into today's note (under the template heading, creating sub-headings as needed), optionally skipping todos today's note already has. It then applies the configured source action (`delete` / `mark`) to the previous day's note. If Templater is enabled and the action is destructive, it first waits 3 seconds and checks that the inserted todos survived. Undo history is kept for 2 minutes; with Templater enabled only the previous day's note is snapshotted.

**Testing:** Tests (`pnpm test`) cover the pure modules: `src/get-todos.test.js`, `src/source-action.test.js`, `src/insert-todos.test.js` and `src/template-headings.test.js`. The vault/UI logic in `index.js` and `src/ui/` needs Obsidian and has no tests, so keep logic in the pure modules where it can be tested.

## Fork and upstream relationship

This is a personal fork of `git@github.com:lumoe/obsidian-rollover-daily-todos.git` (the upstream Obsidian community plugin).

**Branching strategy:**

- `main` — primary branch for this fork. Upstream's `master` changes are selectively cherry-picked here.
- `master` — tracks the upstream `master` branch (kept in sync to make cherry-picking straightforward).
- `release/v1.3.0` — upstream's WIP branch with significant behavioral changes that have not been evaluated yet. Do not merge or cherry-pick from this branch until it has been tested. Keep it around for future reference.

When pulling in upstream changes: fetch from upstream into `master`, then cherry-pick individual commits onto `main`. Avoid bulk-merging `master` → `main` to stay in control of what behavioral changes are adopted.
