# Migration review and todo aging

Design for Phase 1 (review before rolling) and Phase 2 (todo aging) of making this plugin a distinct community plugin rather than a copy of upstream's "Rollover Daily Todos". Drafted 2026-11-03 from the earlier roadmap conversation, without a question round, so every decision below is a call made from the code and the roadmap. The calls most worth checking are listed at the end.

## Intent

Upstream's released plugin (`master`) copies yesterday's unchecked lines forward, optionally deletes them from the old note, and offers undo. This fork has since gained more, but be honest about where it came from: mark-as-moved (`[>]`), skip-todos-already-present, the Templater safeguard, `ignoreBlockquotes` and `skipCompletedChildren` were all ported from upstream's unreleased `release/v1.3.0` branch (see `docs/upstream-v1.3.0-triage.md`), and upstream's v1.3.0 also has its own section routing. They are not differentiators. What is this fork's own is the section-aware core: todos grouped by full heading ancestry, headings recreated in today's note, headings removed from the old note only when a rollover emptied them, and fenced code blocks treated as content. The review and aging work below is entirely new, and it is what should carry the "not a duplicate" case. The next step is to make rollover a deliberate act: you can see what is about to move, decide per todo what happens to it, and the plugin tells you when something keeps getting carried forward without ever being done.

The pitch in one line: **carry todos forward on purpose, and notice the ones that never get done.**

Success looks like:

- A user can run a review, change their mind about three todos, and apply, in under ten seconds.
- A todo that has rolled many times is visible as such, in the note and in the review.
- A user who changes no settings sees no difference from today.

## Goals

1. A review step that lists the todos about to roll, grouped by heading, and lets the user choose an outcome per todo.
2. A rollover counter stored in the todo line itself, incremented on each rollover.
3. A staleness threshold that flags todos which have rolled too often, and an optional backlog note to park them in.
4. Everything undoable with the existing undo command.

## Non-goals

- No weekly/monthly notes, per-heading or per-tag rules, or Tasks-plugin date handling. Those are later phases.
- No per-child decisions. A todo moves with its children as one unit.
- No configurable name for the counter field in this version.
- No separate dry-run command. The review dialog is the preview: closing it changes nothing.
- No persistent rollover log, and undo stays at 2 minutes and in memory.

## Anti-goals

- Existing behaviour changing for anyone who does not turn the new settings on.
- A dialog that blocks the automatic rollover unless the user asked for that.
- Losing a todo: every outcome must leave the todo somewhere visible, or be an explicit user choice (Cancel).
- Counter text that breaks Tasks or Dataview parsing of the line.

## Current structure this builds on

`rollover()` in `src/index.js` reads the previous note, calls `getSections()` (todos grouped by heading, with `incompleteLineIndices` giving each line's position), optionally drops empties and duplicates, inserts with `insertSections()`, then calls `applySourceAction()` on the previous note by line position. Undo restores whole-file snapshots. Almost all logic is in pure, tested modules; `index.js` and `src/ui/` are untested glue. The design keeps that split: new logic goes into pure modules with tests, and the modal stays thin.

## Concepts

**Item.** The unit the user decides about: one top-level todo line in a section plus, when `rolloverChildren` is on, the lines nested under it. It is found by indentation grouping, the same way `dedupeAgainstExisting` groups lines. Without `rolloverChildren`, every open todo line is its own item.

**Outcome.** What happens to an item:

| Outcome      | Today's note                          | Previous note                                              |
| ------------ | ------------------------------------- | ---------------------------------------------------------- |
| **Roll**     | Inserted as now, counter incremented  | Per the "after rollover" setting (none / mark / delete)    |
| **Backlog**  | Not inserted                          | Per the "after rollover" setting, as if it had been rolled |
| **Cancel**   | Not inserted                          | Checkbox set to the cancel marker, never deleted           |
| **Leave**    | Not inserted                          | Untouched                                                  |

Backlog items are appended to the backlog note (see below). Cancel is the only outcome that edits the previous note even when "after rollover" is "none", because the user picked it explicitly.

## Phase 1: review

### When the dialog appears

- New command **Review and roll over todos…**: always opens the dialog, then applies. Existing command **Rollover Todos Now** is unchanged.
- Automatic rollover on note creation follows a new setting, `reviewOnAutoRollover`: `off` (default), `stale` (open the dialog only if at least one item is stale), `always`.
- Closing the dialog with Escape or the Cancel button abandons the whole rollover. Nothing is written. For an automatic run, a notice says the rollover was skipped and the command can be run later.
- If there are no items, there is no dialog, same as today.

### The dialog

A Obsidian `Modal` in `src/ui/ReviewModal.js`. Contents, top to bottom:

1. Title with the source note name: "Roll over from 2026-11-02".
2. Items grouped under their heading path (as plain text, like `Work › Release`), sections in note order. Each row: the todo text (first line only, children indicated as "+2 nested"), a stale badge with the count when applicable ("rolled 5×"), and a dropdown of outcomes. Default is Roll, except stale items whose default follows `staleBehavior` (Roll or Backlog).
3. Per-section and global shortcuts: set all to Roll / Leave. Kept to a small row of buttons.
4. A live summary line: "5 roll, 1 to backlog, 1 cancelled, 2 left".
5. Footer: **Apply** and **Cancel**.

The Backlog option is not offered when `backlogNotePath` is empty. The dialog must work at phone width: one column, rows wrap, no fixed pixel widths.

### Flow change in `rollover()`

The function currently does collect, filter, insert, source-action in one pass. It is split at one point:

1. Collect and filter as today (sections, empties, duplicates).
2. **New:** build items, compute ages, decide whether to show the dialog, and obtain a decision map `{ itemId: outcome }`. Without the dialog, everything is Roll except stale items under `staleBehavior: backlog`.
3. **New:** `applyDecisions()` (pure) turns sections plus decisions into: sections to insert, items for the backlog, line indices to cancel, line indices left alone, and line indices that moved (rolled plus backlog).
4. Insert into today's note, append to the backlog, then change the previous note, as now.

Today's note is read after the dialog closes, not before, so a slow review does not insert against stale content. The previous note is already guarded by the "edited meanwhile" check, which now also covers a long review: if it changed, the rollover reports that and does nothing to it.

### Invariants for the previous-note change

- `rolledLineIndices` passed to `applySourceAction` contains only Roll and Backlog items.
- With "delete", the lines deleted are the lines found minus those of Leave and Cancel items. Today the code passes every found line (including empty todos that were not rolled), which would delete left-behind items under review. Empty todos that were dropped before the dialog keep today's behaviour.
- Cancelled lines are marked after the source action runs and are never deleted, nor removed by `moveNestedItemsOnMark`.

## Phase 2: aging

### The counter

Stored in the todo line as a Dataview-style inline field, at the end of the first line of an item:

```markdown
- [ ] Write the quarterly report [rolled:: 3]
```

Why inline and not in `data.json`: it is visible, survives sync, is correct on every device, follows the todo if the user edits its text, and can be queried (`rolled > 3`) by Dataview users. A hidden table keyed by text would silently reset whenever someone fixes a typo.

Rules (pure module `src/rolled-count.js`):

- `parseRolledCount(line)` returns the number, or 0 if the field is absent.
- `setRolledCount(line, n)` writes or replaces the field. It goes at the end of the line, but before a trailing block id (`^abc123`), which Obsidian requires to stay last.
- `stripRolledCount(line)` removes the field and the space before it.
- Only the first line of an item carries a counter. Nested children are rolled unchanged.
- The count on the inserted copy is `previous + 1`. The previous note's line is not rewritten, so marking leaves `- [>] Write the quarterly report [rolled:: 2]`.
- A count is per rollover, not per day: a todo that sits across a weekend and rolls once is count +1.

`dedupeAgainstExisting` and `verifyTodosPresent` compare lines with the field stripped from both sides. Without this, "skip todos already in today's note" would stop matching as soon as counters exist.

### Staleness

`staleAfterRollovers` (default 5): an item is stale when its current count is at least this value, so with 5 it is flagged on the sixth rollover. Staleness only applies when `trackRolloverCount` is on.

What staleness does:

- In the dialog, shows the badge and sets the default outcome per `staleBehavior`.
- Triggers the dialog when `reviewOnAutoRollover` is `stale`.
- Without a dialog, `staleBehavior: backlog` sends stale items to the backlog automatically. The notice says how many and where. This is opt-in, and the default is `keep` (roll anyway).

### The backlog note

`backlogNotePath` (default empty, which disables Backlog) and `backlogHeading` (default empty, meaning end of file).

Pure module `src/backlog.js`: `appendToBacklog(content, heading, lines)` returns new content, putting lines under the heading (creating it if missing) or at the end. Each appended item is the todo with its children, the counter stripped so it does not look stale the moment someone pulls it back, plus a `[from:: [[source note]]]` field, after a space, on the first line so its origin is known.

The plugin creates the backlog note, and any missing folder, if it does not exist.

### Undo

The undo snapshot gains a third entry for the backlog note. If the rollover created the note, undo deletes it; otherwise it restores the old content. `UndoModal` lists the backlog change with the other files. The 2-minute window and the Templater rule (today's note is not restored when Templater is on) are unchanged.

## Settings

All new settings are added to `loadSettings()` defaults, so existing users keep today's behaviour.

| Setting                | Default | Notes                                                       |
| ---------------------- | ------- | ----------------------------------------------------------- |
| `trackRolloverCount`   | `false` | Writes `[rolled:: n]`. Off so existing notes are not touched. |
| `staleAfterRollovers`  | `5`     | Disabled in the UI while tracking is off.                   |
| `staleBehavior`        | `keep`  | `keep` or `backlog`; used when no dialog is shown.          |
| `reviewOnAutoRollover` | `off`   | `off`, `stale`, `always`.                                   |
| `backlogNotePath`      | `""`    | Empty disables the Backlog outcome.                         |
| `backlogHeading`       | `""`    | Optional.                                                   |
| `cancelMarker`         | `-`     | Checkbox character for Cancel; normalised like the mark marker. |

The settings tab gets two new groups, "Review" and "Aging". Use `Setting#setHeading()` for the group titles. The new cancel marker counts as a done marker while cancelling, the same way the rollover marker already does.

## Edge cases

- **CRLF files:** cancel marking handles `\r` the way `applySourceAction` does for mark.
- **Block ids:** counter goes before a trailing `^id`.
- **Items inside blockquotes or callouts:** unaffected; `ignoreBlockquotes` runs earlier in `getSections`.
- **Running rollover twice in one day:** same as today. With "after rollover: none" and no skip-existing, todos duplicate and counters rise again. Skip-existing prevents both, because comparison ignores the counter.
- **Backlog path equals today's or the previous note:** refuse and show a notice; do nothing.
- **Partial failure:** write order is today's note, backlog, previous note. If the backlog write fails, the previous note is not touched, and the notice says what did happen.
- **Templater:** the existing 3-second verification runs after insertion as now, comparing counter-stripped lines.

## Testing

Unit tests, in the existing vitest style, for the pure modules:

- `rolled-count.test.js`: parse, set, strip; block id placement; missing field; non-numeric field is treated as absent; idempotence of `setRolledCount`.
- `rollover-items.test.js`: grouping into items with and without children; `applyDecisions` for every outcome; indices stay aligned after filtering; "delete" excludes Leave and Cancel lines.
- `backlog.test.js`: append at end, under an existing heading, under a missing heading, empty file.
- `source-action.test.js`: cancel marking, CRLF, interaction with mark and moveNested.
- `insert-todos.test.js`: dedupe ignores counters.
- `rollover-flow.test.js`: extend the end-to-end helper with decisions, counters and backlog.

The dialog, the settings tab and the file writes cannot be unit tested. They are checked by hand in `/home/lyndonw/data/obsidian-stuff/test-vault` against a short script: auto rollover with the dialog off (identical to today), review with a mix of outcomes, cancel with Escape, a stale item, backlog creation, undo of each, and a phone-width window.

## Left to the builder

- Dialog markup and CSS, within Obsidian's `Modal` and `Setting` APIs and its theme variables (no hard-coded colours).
- Whether `rollover()` is split into several methods or helper functions, as long as the pure parts stay out of `index.js`.
- Notice wording.

## Calls to check

These were decided here, not by the project owner:

1. The counter is an inline `[rolled:: n]` field rather than hidden data, and tracking is off by default.
2. Cancel marks `[-]` and is available even when "after rollover" is "none".
3. Automatic backlogging of stale todos exists but is opt-in; the default keeps rolling them.
4. Backlog entries get a `[from:: [[note]]]` link and lose their counter.
5. The Rollover Todos Now command stays review-free; only the new command and the auto setting open the dialog.
6. Four outcomes (Roll, Backlog, Cancel, Leave) rather than fewer. Leave could be dropped if it feels redundant with Cancel.
