# Bring back from the backlog

Design for step 5 of Phase 3 (more sources) in `docs/roadmap.md`: the backlog note becomes a source, read by a command of its own, so todos parked in it can come back into today's note. Written on 2026-11-23.

Decided by the user: the backlog is offered through its own command, **Bring back from backlog…**, not inside "Review and roll over todos…" (option 2 of three: inside the review only, own command, both); and it is built on the multi-source pipeline, with the write stage after the review shared between the rollover and the new command (approach A of three: reuse the pipeline, a separate small flow, a "backlog only" flag on `rolloverDailyNote()`). Everything else is a call made from the code and the roadmap; the ones most likely to matter are listed under [Calls to check](#calls-to-check).

## Intent

Phase 2 parks todos in the backlog note (the Backlog outcome, or stale todos under `staleBehavior: "backlog"`), each with `[from:: [[source note]]]`. Nothing brings them back: the user has to copy a line by hand and delete it from the backlog. That leaves the backlog a one-way drawer, and the Bullet Journal idea of deliberate migration only half done.

The new command lets the user, whenever they have room (often mid-day, not during the morning rollover), open the backlog, pick a few todos, and have them moved into today's note.

Success looks like:

- Running **Bring back from backlog…** lists the backlog's open todos, all set to stay; choosing **Bring back** on two of them and applying puts those two in today's note, without `[from:: …]`, and removes them from the backlog, whose headings stay.
- The morning review is unchanged: no backlog group, no longer dialog.
- "Undo last rollover" undoes a bring back.

## Goals

1. A command, **Bring back from backlog…** (id `bring-back-from-backlog`), shown in the command palette only while a backlog note is set.
2. A dialog listing the backlog's open todos, grouped by the backlog's headings, every one defaulting to **Stay**, with **Bring back**, **Stay** and (when available) **Cancel**.
3. Brought-back todos land in today's note where rolled todos land, without `[from:: …]`, and are deleted from the backlog (nested lines with them, as "Roll over children of todos" says).
4. Cancel marks the todo cancelled in the backlog, as Cancel does in a daily note.
5. Undo through the existing "Undo last rollover" command.
6. The safety the rollover has: one run at a time, "edited meanwhile" check on the backlog, today's note written before the backlog is touched, write failures leaving the backlog unchanged.

## Non-goals

- Offering the backlog in "Review and roll over todos…" or in automatic rollovers.
- A search or filter field in the dialog (see [Follow-ups](#follow-ups)).
- Keeping the `[rolled:: n]` count across a park and return: it is stripped when parked (`backlogLines()`), so a returning todo starts with no counter, and the next rollover counts 1.
- Creating today's note from the command.
- Bringing todos back into any note other than today's daily note.
- Moving a backlog item to a different backlog heading (reorganising the backlog).

## Anti-goals

- Any change to the rollover's behaviour. The shared write stage is a refactor; the e2e baselines (`defaults`, `checklist`) and every existing e2e file must pass untouched.
- A todo lost: today's note is written first; the backlog is left unchanged if it was edited during the dialog, with a notice; nothing the user left on Stay is touched.
- The backlog changed without the user choosing it: no default other than Stay, no rule picking Bring back, and lines the dialog did not offer (empty todos, completed todos, Not a todo lines) are never removed.

## Design

### The command

`onload()` adds:

```js
this.addCommand({
  id: "bring-back-from-backlog",
  name: "Bring back from backlog…",
  checkCallback: (checking) => {
    if ((this.settings.backlogNotePath ?? "").trim() === "") return false;
    if (!checking) void this.bringBack();
    return true;
  },
});
```

`bringBack()` does, in order:

1. **Daily notes settings and today's note.** As `rollover()` does for a command run: `getDailyNoteSettings()` (its notice when `null`), `isDailyNotesEnabled()` (its notice when not), the clock read once, `todayNotePath()`. When today's note does not exist: notice "Create today's daily note first, then bring todos back." No creation-time check (this is never automatic).
2. **One run at a time.** It shares `rolloverInProgress` with `rollover()`: while one is running, "A rollover is already in progress." Both write today's note and the backlog.
3. **The guard.** The backlog note being today's note stops it with `BACKLOG_GUARD_NOTICE` (the same text as the rollover's). The previous daily note and Look back's older notes are not compared: this command reads none of them.
4. **Read and parse the backlog** with the same `getSections()` options as the rollover's sources (children, skip completed children, blockquotes, Not a todo rules, done markers). A missing note: "There is no backlog note at '{path}' yet." No open todos: "The backlog note '{name}' has no open todos."
5. **Plan** with `planSources()` on one source, `backlogSource(…)` (below).
6. **Dialog**: always shown (`ReviewModal` in its backlog form, below). Closing it any way but Apply ends the run, nothing written, no notice.
7. **Nothing chosen**: when no item is Bring back or Cancel, the run ends with the notice "Nothing brought back." and nothing written (no undo entry; the previous one stays).
8. **Write** through the shared write stage (below), with the Templater wait off.

### The backlog source

`rollover-sources.js` gets `backlogSource({ file, content, lines, sections })`:

```js
{
  key: "backlog/",
  kind: "backlog",
  name: file.basename,
  file, content, lines, sections,
  sourceAction: "delete",
  keepHeadings: true,
  countRollover: false,
  flatten: true,           // new: see "Where returning todos land"
}
```

`planSources()` treats `kind: "backlog"` as follows:

- **Every item defaults to `"leave"`** (shown as Stay).
- **Outcome rules are ignored**: the item's `rule.outcome` and `rule.outcomeRule` are dropped, so no rule picks Bring back, Backlog, Cancel or Leave, and no outcome badge is shown. A tag rule such as `#someday` → Backlog would otherwise mean nothing here, and a Roll rule would preselect items the user did not pick.
- **Move to heading rules still apply**: an item a rule moves goes to that heading in today's note when brought back, and the dialog shows its `→ heading` badge while it is set to Bring back.
- **Not a todo rules apply** through the parser, as everywhere.
- **No Stale count** has no effect: `countRollover: false` already keeps counters as they are.
- **Empty todos** are dropped from the dialog as `removeEmptyTodos` says, but never deleted from the backlog (see below).

### Outcomes in the dialog

| Outcome key | Label in the backlog dialog | What happens |
|---|---|---|
| `roll` | Bring back | Into today's note; deleted from the backlog with its nested lines. |
| `leave` | Stay | Untouched (default). |
| `cancel` | Cancel | Marked with the cancel marker in the backlog, as in a daily note. Offered only when `isCancelAvailable()`. |
| `backlog` | — | Not offered. |

The keys stay the rollover's, so `applyDecisions()`, `countOutcomes()` and the rest work unchanged; only the labels differ.

### Review dialog, backlog form

`ReviewModal` gets an option (name left to the builder) for its backlog form:

- Title: "Bring back from {name}".
- The outcomes above, with their labels; the shortcut buttons read **All back** / **All stay** (on the top "All todos" row and on each heading row).
- Summary: "2 to bring back, 1 cancelled, 14 stay" (counts of zero left out, as now).
- Apply button text: **Apply**, as now.
- Each item whose head carries `[from:: [[X]]]` shows a "from X" badge (class `rollover-rule-badge`'s look, or its own class) and its label leaves the field out. A todo typed into the backlog by hand has no badge.
- Stale badges are not shown (the counter was stripped when parked).

Sections are the backlog's headings in note order (normally the one `backlogHeading`, or "(no heading)"), as for a daily note. A long backlog scrolls inside the dialog, which is how the review dialog already behaves; the phone-width layout must not overflow (checked in e2e).

### Where returning todos land

Under the template heading when one is set (`templateHeading`), otherwise at the end of today's note, **without the backlog's headings**: a backlog heading such as `## Someday` or `## Backlog` means nothing in a daily note. The source's `flatten: true` makes its rolled sections insert with an empty `headingPath` (one section per backlog section, or merged; left to the builder), while the dialog still groups by the backlog's headings. A Move to heading rule wins, as for every source.

`leadingNewLine` and the existing list-continuation behaviour apply as for rolled todos.

### On the way in

- `[from:: …]` is removed from each returning item's head line before anything else looks at it: before skip-existing compares it with today's note, before it is inserted, and before `verifyTodosPresent()` would see it. A new pure helper (e.g. `stripFromField()` next to `stripRolledCount()` in `rolled-count.js`) removes the field and the single space before it. Only the head line carries one (`backlogLines()` writes it there); nested lines are left as they are.
- Counters are not raised (`countRollover: false`). A counter typed by hand stays as it is.
- With **Skip todos already in today's note** on, a returning todo today's note already has (compared without `[from:: …]`) is not inserted again, and still counts as handled, so it is deleted from the backlog. Notice: "- 1 was already in today's note."
- `rebaseSections()` applies as for any source: a nested todo whose parent stays in the backlog starts at column 0.

### What happens to the backlog

Through `writeSource()` in its own `vault.process()`, with the "edited meanwhile" check, after today's note:

- Bring back items: deleted with their nested lines (`sourceAction: "delete"`), headings kept (`keepHeadings: true`), the note never deleted even when empty.
- Cancel items: marked with the cancel marker.
- Stay items: untouched.
- **Empty todos the dialog dropped are not deleted.** Under Delete, the rollover also deletes dropped empty todos from its source; the backlog only loses what the user chose. `applyPlan()`'s delete lines for a `"backlog"` source leave out the dropped lines (`droppedLineIndices`) that do not belong to a Bring back item. Skipped completed children belonging to a Bring back item are removed with it, as in a daily note.
- `sourceNeedsWrite()` for `"backlog"`: only when it has moved or cancelled lines (as for `"earlier"`), which step 7 above already guarantees.
- Edited meanwhile: left unchanged, notice "Bring back left the backlog note '{name}' unchanged: it was edited while the dialog was open. Its todos were still added to today's note; remove them from the backlog yourself." `sourceLabel()` gets `"the backlog note '{name}'"` for `kind: "backlog"`, so `sourceWriteFailedNotice()` names it too.

### The shared write stage

Everything in `rolloverDailyNote()` after the decisions are known moves into one method (name left to the builder, e.g. `writeRollover()`), called by both `rolloverDailyNote()` and `bringBack()`:

1. `applySources()`.
2. Today's note in one `vault.process()` with `insertSources()`.
3. The Templater safeguard, when enabled by the caller.
4. Backlog items appended with `writeBacklog()` (none for a bring back: Backlog is not offered).
5. Each source through `sourceNeedsWrite()` / `writeSource()` with its edited-meanwhile and failure handling.
6. The notice, and `recordUndo()` in a `finally`.

Its options cover what differs between the two callers:

- **Templater.** The rollover keeps the 3-second wait and its undo rule (today's note not snapshotted with Templater on). A bring back writes into a note Templater rendered long ago, so it skips the wait and always snapshots today's note for undo. Without that, undo with Templater on would restore the backlog but leave the copies in today's note.
- **The notice.** The rollover keeps `rolloverNotice()`; a bring back uses a new pure `bringBackNotice({ broughtBack, alreadyPresent, cancelled, name, templateHeadingNotFound, templateHeading })`: "Brought back 2 todos from Backlog.", "- 1 was already in today's note.", "- 1 cancelled.", and the template-heading-not-found line the rollover shows, worded the same.

The refactor lands first, on its own commit, with the full unit and e2e suites passing unchanged, before any bring-back code.

### Undo

The undo entry is the rollover's shape, `{ today, sources: [backlogEntry], backlog: { file: undefined } }`, plus `kind: "bring-back"`. It replaces the previous entry, as any rollover does, and is kept for 2 minutes. The backlog's entry is a plain snapshot (no `keepNewLines`): nothing else writes to the backlog automatically.

`UndoModal` keeps its title and restore logic. For `kind: "bring-back"` its description says: "Undoing a bring back puts today's note and the backlog note back as they were before it. Any text you added to them since may be lost." The per-note lines are unchanged.

### Settings and docs

No new settings. The Backlog settings group's `?` help gets one sentence naming the command. README: a "Bringing todos back" paragraph under the backlog section. `CLAUDE.md`: the command, `backlogSource()` and `kind: "backlog"`, the shared write stage, the undo entry's `kind`. Roadmap: tick the item, note the filter follow-up.

## Testing

Unit (`pnpm test`):

- `rolled-count.test.js`: `stripFromField()` (field in the middle, at the end, before a Tasks emoji field, before a block id, absent, a link with an alias `[[a|b]]`).
- `rollover-sources.test.js`: `backlogSource()`; `planSources()` with a `"backlog"` source (all Stay, outcome rules dropped, move rules kept); `sourceNeedsWrite()` for `"backlog"`; `sourceLabel()`; `bringBackNotice()`.
- `rollover-flow.test.js`, through the same calls as `index.js`: a parked item round trip (park with `appendToBacklog()`, bring back, the line equals the original minus its counter); Bring back under the template heading and at the end without one, without backlog headings; Cancel marks in the backlog; Stay untouched; empty todos and completed todos left in the backlog; nested lines going with their item; skip existing comparing without `[from:: …]` and still deleting from the backlog; a Move to heading rule.
- Every existing test unchanged after the refactor commit.

e2e (new `e2e/bring-back.e2e.js`; timing-dependent tests get the flakiness check of `CLAUDE.md`):

- The command is not in the palette without a backlog note, and is with one.
- A backlog with three items: the dialog shows three rows on Stay with their "from" badges; bring back two, cancel none → today's note has the two without `[from:: …]` under the template heading, the backlog keeps its heading and the third.
- Cancel marks in the backlog.
- Apply with everything on Stay: "Nothing brought back.", no note changed.
- Undo restores today's note and the backlog.
- No today's note: the notice, nothing changed. An empty backlog: the notice.
- The backlog edited while the dialog is open: today's note gets the todos, the backlog is unchanged, the notice.
- The dialog at phone width: no horizontal overflow (`horizontalOverflow()`).
- Round trip: park a todo with "Review and roll over todos…", then bring it back.

Also: `baseline.e2e.js` and the rest of the e2e suite after the refactor commit, unchanged.

Offer the user a private review clip of the bring-back dialog (`e2e/demos/private/bring-back.demo.js`).

## Known limitation

A brought-back todo still carries its tags, so a rule that parks them sends it back. With a `#someday` → Backlog rule on, "Learn Rust #someday" brought back today goes back to the backlog on the next rollover without a review (with the review, it opens on Backlog with the rule's badge). Accepted by the user on 2026-11-23: the README says to remove the tag when bringing such a todo back.

## Follow-ups

- A filter field in the dialog, should real backlogs make scrolling painful.
- Offering the backlog inside "Review and roll over todos…" (option 3, "both"), which needs the backlog written once for both directions in one `vault.process()`.

## Left to the builder

- The name of the shared write method, its option names, and the `ReviewModal` option for its backlog form.
- How `flatten` turns sections into insert sections (keep one per backlog section with an empty heading path, or merge them).
- The exact place in `applyPlan()` / `applySources()` that keeps dropped empty todos out of a backlog source's delete lines.
- The "from" badge's CSS class.

## Calls to check

1. **No outcome rule applies to backlog items**: everything opens on Stay. Move to heading and Not a todo rules still do.
2. **Returning todos land where rolled todos land, without the backlog's headings.**
3. **No today's note → a notice**, not creating it (creating it would start the automatic rollover, which then races this command).
4. **The Templater wait is skipped and today's note is always undoable** for a bring back.
5. **Delete is the only action on the backlog**, not Mark: a marked line would stay in the backlog forever.
6. **Empty todos in the backlog are never removed** by a bring back, unlike the rollover's Delete on a daily note.
7. **The command is hidden while no backlog note is set**, rather than shown with a notice.
8. **Apply with nothing chosen writes nothing and keeps the previous undo entry.**
9. **Undo goes through "Undo last rollover"**, not a command of its own.
