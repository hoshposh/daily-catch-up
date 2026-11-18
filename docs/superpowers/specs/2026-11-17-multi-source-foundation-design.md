# Multi-source foundation

Design for step 1 of Phase 3 (more sources) in `docs/roadmap.md`: a rollover reads a list of source notes instead of exactly one. The list holds only the previous daily note, so nothing changes for users. Written on 2026-11-17. The user chose the Phase 3 order (this foundation, then an inbox source) and asked for the design without a question round, so every design decision here is a call made from the code; they are listed under [Calls to check](#calls-to-check). The next spec, `2026-11-17-inbox-source-design.md`, adds the first second source on top of this.

## Intent

All Phase 3 items (inbox note, last N days, backlog as a source, project notes) read todos from more than one note in a single rollover. Today the whole rollover is written around one note, so each item would otherwise reopen the same parts of `src/index.js`, the review dialog and undo. Doing the refactor once, on its own and with no behaviour change, keeps each later item small and lets the existing tests and e2e baselines prove the refactor safe before anything new depends on it.

Success looks like:

- Every existing unit test and e2e test passes with no change to an expected output (test helpers may change how they call the code).
- Adding a second source later means building one more source object and passing it in, plus that source's own settings and UI.

## Goals

1. A rollover works on a list of **sources**. Each source is one note: its file, content, lines, parsed sections and source action. Only the previous daily note is built.
2. Each source is planned with the existing pure steps (`planDecisions()`, `applyPlan()`), on its own line positions. Items from different sources have distinct ids, so one decisions map covers them all.
3. Today's note is still read and written in one `vault.process()`. Inside it, the sources are inserted one after another, each planned (`planInsert()`) against the content as the sources before it left it.
4. The backlog note is still written once. Each backlog item carries its source note's name for `[from:: [[…]]]`.
5. Each source note is written in its own `vault.process()` with its own "edited meanwhile" check. A source left unchanged does not stop the others.
6. Undo snapshots any number of source notes.
7. The rollover notice is built by a pure function from per-source counts, so its text is pinned by unit tests.
8. The review dialog takes a list of sources. With one source it looks and behaves exactly as today.

## Non-goals

- Any new source, setting or command. The inbox spec adds the first.
- The review dialog's layout for more than one source. The inbox spec designs it, where it can be seen and tested.
- Changing what happens to a single source's todos.

## Anti-goals

- Any visible change for current users: today's note, the previous note, the backlog note, notices, the review dialog and undo all stay exactly as they are. The `defaults` and `checklist` baselines in `e2e/fixtures/expected/` must pass untouched (never regenerate them for this work).
- Rewriting the pure modules' contracts. Line positions stay per note, and `applyDecisions()`, `applySourceAction()`, `skippedLinesToDelete()` and `insertSections()` keep their signatures.
- Moving more logic into `src/index.js`. New orchestration logic goes in a pure module where it can be unit tested.

## Current structure (the single-source assumptions)

`rolloverDailyNote()` in `src/index.js`:

- `getLastDailyNote()` (around line 85) returns one file (`sorted[1]`); the rollover returns early when there is none, or when it has no open todos.
- It reads that note once (`lastDailyNoteContent`, `lastDailyNoteLines`) and parses it with `getSections()`.
- `planDecisions()` → optional `ReviewModal` (titled `Roll over from ${lastDailyNote.basename}`) → `applyPlan()`. Item ids are `${sectionIndex}:${start}` (`toItems()` in `src/rollover-items.js`), unique only within one note.
- Today's note: one `vault.process(file, …)` running `planInsert()` then `insertSections()`.
- The Templater safeguard waits and checks `verifyTodosPresent()` when `sourceAction !== "none"`.
- The backlog note: `writeBacklog(path, items, lastDailyNote.basename)`, one source name for all items (`backlogLines()` in `src/backlog.js`).
- The previous note: one `vault.process(lastDailyNote, …)` that leaves the note alone if it changed since it was read, then `markCancelled()` and `applySourceAction()`.
- The notice is assembled inline (around lines 600–665), including `left in ${lastDailyNote.basename}`.
- Undo: `undoHistoryInstance = { previousDay, today, backlog }`; `recordUndo()` and `UndoModal.confirmUndo()` / `onOpen()` know those three slots by name.
- The backlog path guard refuses a backlog note that is today's note or the previous note.

## Approaches

1. **Per-source pipeline, merged at the edges (chosen).** Each source runs the existing pure steps on its own line positions. The sources only meet where the user or a shared note sees them: one decisions map for the review dialog, one write of today's note (sources inserted in turn), one backlog write, one undo entry, one notice. The pure modules are untouched apart from an id prefix; the new code is a thin pure layer that loops over sources.
2. **One merged plan with positions as (note, line) pairs.** Every function that handles line positions would change (`applyDecisions()`, `ownership()`, `applySourceAction()`, `skippedLinesToDelete()`, the retain lists), for no gain: each note is still written separately, so the pairs would be split up again before writing.
3. **Run the whole rollover once per source.** Least new code, but N review dialogs, N notices, N undo entries (undo keeps only the last), today's note written N times and the Templater wait repeated per source. Rejected.

## Design

### Source

A plain object built in `index.js`, and by tests directly:

```js
{
  key: "",                 // item id prefix; "" for the previous daily note, so its ids stay "0:0" etc.
  kind: "previous",        // what the source is; notices and the dialog word things by kind
  name: "2026-11-16",      // the note's basename: dialog, notices, [from:: [[name]]]
  file,                    // TFile (absent in pure tests)
  content,                 // the note as read
  lines,                   // splitLines(content)
  sections,                // getSections(...) on lines
  sourceAction,            // "none" | "delete" | "mark" (resolveSourceAction() for the previous note)
}
```

Later sources add fields (the inbox spec adds `keepHeadings`, `countRollover` and `placement`). The pure layer must treat a missing field as the previous note's behaviour.

Building the list: the previous daily note when `getLastDailyNote()` finds one and it has open todos. Sources without open todos are dropped. When the list is empty the rollover returns, as today.

### Pure orchestration module

A new pure module (suggested `src/rollover-sources.js`) on top of `src/rollover-plan.js`:

- **Planning:** `planDecisions()` per source, with a new optional `idPrefix` passed down to `toItems()` (ids become `${idPrefix}${sectionIndex}:${start}`). Returns the per-source plans, all items in source order, and the merged default decisions.
- **Applying:** `applyPlan()` per source, with the merged decisions. Returns, per source, everything `applyPlan()` returns today, plus summed outcome counts.
- **Inserting into today's note:** a function called inside today's `vault.process()` callback. For each source in order: `planInsert()` against the current content (with that source's `lines` and `noStaleLineIndices`), then `insertSections()`, and carry the new content into the next source. Returns the final content and, per source, `todosAlreadyPresent`, `duplicateTodos`, `retainedLineIndices` and the inserted todos, plus whether the template heading was missing.
- **Backlog items:** each source's backlog items tagged with the source's `name`. `backlogLines()` uses `item.sourceName` when present, else its `sourceNoteName` argument (so existing callers and tests keep working).
- **Notice:** a function that takes the counts and returns the notice text, reproducing today's text exactly for one previous-note source, including "left in {name}".

`src/rollover-flow.test.js`'s `reviewedRollover()` helper is rewritten to call this module the way `index.js` does, with its expected outputs unchanged. That is the unit-level proof of no behaviour change.

### index.js

`rolloverDailyNote()` builds the source list, then:

1. Plans all sources; refuses a backlog note that is today's note or any source's file (same notice as today).
2. Opens the review dialog when `review`, or when `needsReview()` says so for all items together.
3. Applies the decisions.
4. Writes today's note once (as now), via the insert function.
5. Templater safeguard: waits and verifies when any source's action is not `"none"`, with the inserted and duplicate todos of all sources.
6. Writes the backlog once (as now). If it fails, no source note is touched.
7. Writes each source in list order, each in its own `vault.process()` with its own "edited meanwhile" check and notice. The previous note's notice keeps today's text.
8. Builds the notice with the pure function and records undo.

### Undo

`undoHistoryInstance.previousDay` becomes `sources: [{ file, oldContent }]`, holding each source note the rollover changed. `recordUndo()` keeps an entry when today, the backlog or any source has a snapshot. `UndoModal` lists and restores each source. Its description text stays as it is (it only mentions the previous day's note, which is still the only source); the inbox spec updates it.

### Review dialog

`ReviewModal` takes `sources: [{ name, sections, items }]` and the merged decisions in place of `sourceName`, `sections` and `items`. Items keep their `sectionIndex` within their own source. With one source it renders exactly what it renders today, including the title `Roll over from {name}`. What it shows for several sources is left to the inbox spec. Until then it may throw or render them one after another; nothing passes it more than one.

## Testing

- Unit tests for the new module: two sources with overlapping todo text (ids distinct, decisions merged, the second source deduped against the first's insertions with skip existing on and not deduped with it off), backlog items tagged with their source names, and the notice text for every line the notice can have (rolled, empty removed, already present, backlog, cancelled, left, template heading missing).
- `toItems()` / `planDecisions()` with and without `idPrefix`.
- `backlogLines()` with `item.sourceName`.
- `src/rollover-flow.test.js` through the new module, expectations unchanged.
- The full e2e suite unchanged, including `baseline.e2e.js`, `outcomes.e2e.js` (undo) and `guards.e2e.js`. No new e2e test is needed for a refactor that must not change anything visible; the inbox work adds e2e tests for the multi-source paths.

## Docs

`CLAUDE.md`: the new module, the source object, the undo shape and the updated rollover flow. Roadmap: tick the foundation box.

## Left to the builder

- The module's name and function names, and how results are threaded between the steps.
- Whether the notice function lives in the new module or its own.
- Whether `getLastDailyNote()` is generalised now (for example to return a sorted list) or left for the "last N days" item.

## Calls to check

1. **Approach 1**: per-source pipelines merged at the edges, not one merged plan.
2. **Sources are inserted into today's note one after another inside one `vault.process()`**, so with skip existing on, a later source is deduped against what an earlier one just inserted.
3. **One review dialog and one decisions map for all sources**; ids get a source prefix, except the previous note's, which keep today's ids so existing tests and decisions are untouched.
4. **One backlog write, with `[from:: [[…]]]` per item.**
5. **A source edited during the rollover is left unchanged on its own**; the other sources are still written.
6. **The notice text moves to a pure function**, pinned by tests to today's wording.
