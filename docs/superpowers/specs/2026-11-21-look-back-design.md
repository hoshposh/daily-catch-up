# Look back over earlier daily notes: design

Date: 2026-11-21. Roadmap: Phase 3, item 4 ("Gather from the last N days"), in [roadmap.md](../../roadmap.md). Use cases: [roadmap-phase-3-use-cases.md](../../roadmap-phase-3-use-cases.md) ("Recovering after a gap") and [roadmap-phase-4-use-cases.md](../../roadmap-phase-4-use-cases.md) ("Snoozing a todo").

## Intent

Today a rollover reads one daily note: the newest one dated before today (`getLastDailyNote()` → `previousDailyNote()` in `src/daily-notes.js`), plus the inbox note when one is set. This feature lets a rollover also read the daily notes from the last N days, so todos that sit further back than the previous note still come forward.

It is new capability, not a fix for a problem the maintainer has hit. It serves:

- **Breaks in the chain.** A note created without a rollover (review dialog closed on an automatic run, a phone without the plugin, Templater overwriting the rolled todos) strands the todos in the note before it, because the next rollover only reads the newest note.
- **Late additions.** A todo added on Thursday to Tuesday's note never rolls, because Thursday's note already exists.
- **Snoozing, later (Phase 4).** A todo snoozed to 1 December sits in a note from weeks ago and has to be found on the day. This feature is what snoozing will stand on; nothing for snoozing is built now.

## Goals

- A **Look back** setting: a number of days, 0 (off) by default. With N > 0, every daily note dated within the last N days before today is read as a source, besides the previous daily note.
- No guessing about which open todos were already handled: Look back only works when the previous note's source action (**After rollover**) is Mark or Delete, so an open todo in an older note is one that never rolled.
- Each older note is a source of its own on the existing multi-source machinery (`src/rollover-sources.js`): its own write with Mark or Delete, its own "edited meanwhile" check, its own undo snapshot, its own "From …" group in the review.
- The window is counted in the periods of the note series, not hard-wired to days, so a later weekly or monthly source can look back N weeks or N months with the same code.

## Non-goals

- Working under the default **After rollover: Leave them alone** (None). Telling a handled todo from a stuck one under None needs either stored state (the plugin remembering what it rolled) or text matching (which brings back todos deleted on purpose). Either could be added later for None users without changing this design. Not now.
- Weekly, monthly or other non-daily notes as sources. The window helper allows for them; adding such a source is a separate decision (the roadmap's **Not planned** section currently leaves rolling between frequencies to the Journals plugin).
- Anything for Obsidian Tasks dates (snoozing, start dates). Phase 4.
- Deduplicating todos across older notes beyond what **Skip todos already in today's note** already does.
- Replaying missed rollovers into the notes between (see Approaches).

## Anti-goals

These would make the feature a failure even if it worked as specified:

- **Bringing back a todo the user finished or deleted in a newer note.** That puts noise in today's note that has to be cleaned by hand, which is worse than missing a stranded todo. This is why Look back requires Mark or Delete, starts from the day it was turned on, and skips todos already done in a newer note (see "Not bringing back finished todos"). One case is left, accepted and documented in the README: a todo deleted on purpose from today's note after its source note could not be marked (edited during the rollover, a failed write, the Templater safeguard) comes back from that source note the next day.
- **Any change for users who don't turn it on.** With Look back at 0, or with its dependencies not met, a rollover reads exactly what it reads today and every e2e baseline stays byte for byte the same.
- **A review dialog full of noise.** A week of habit lists or meeting agendas, left behind by rules, must not show up in the review every day.

## Approaches

The approach was chosen in two steps.

**How to tell a handled todo from a stuck one** (chosen: A).

- **A. Only with Mark or Delete (chosen).** Under Mark or Delete, the rollover changes every todo it rolls, so an open todo in an older note never rolled: it was stranded or added late. No guessing and no stored state. The cost: users on the default None can't use Look back until they switch. The builder review found where A alone falls short: open copies left from before a switch from None, copies made by hand on a phone, and source notes the rollover had to leave unchanged. Two additions close those (chosen with A, see "Not bringing back finished todos"): a start date, and skipping todos done in a newer note.
- B. The plugin remembers what it rolled (note and todo text in `data.json`) and skips those. Works under None and never edits old notes, but adds state that sync has to carry between devices, and a first run that has nothing remembered yet.
- C. Skip a todo when the same text is in a newer note. No state, works under None, but a todo deleted on purpose in a newer note comes back (the first anti-goal), and it can't be told apart from a late addition.

**How to build it** (chosen: one source per older note).

- **Each older note is its own source (chosen).** It slots into the source list `rolloverDailyNote()` already builds, and gets per-note writes, undo, the edited-meanwhile check and review groups from the multi-source foundation.
- Merging the older notes into one "Earlier notes" source. A source's line positions refer to one file, so this would mean rebuilding writes, undo and the edited-meanwhile check for a source spread across files: the foundation work over again, for one fewer heading in the review.
- Replaying the missed rollovers in order (oldest into the next, up to today). It writes todos into old notes that aren't today's, raises counters several times for one real rollover, and multiplies what can go wrong.

## Decisions

### What Leave means with Look back on

A Leave chosen by hand in the review means **"not today"**: the todo stays open in its note, so the next rollover finds it again (that note is then an older note inside the window), until the note falls out of the window. This is how the inbox's Leave already works. Without a review on the next run, the todo gets its default outcome then (usually Roll). To drop a todo for good, the user picks Cancel. No state is stored for Leave.

Rule-chosen Leaves (a rule whose effect is Leave, such as the examples `Tag #habit → Leave` and `Heading "Meetings" → Leave`) need nothing stored either: the rule still matches each day, so they stay put. Items **from an older note** (not the previous note, not the inbox) whose default outcome is Leave because of a rule are kept out of the review:

- not shown in `ReviewModal`, and not touched by its All roll / All leave buttons, so they stay Leave;
- not counted by `needsReview()` or by the "items.length > 0" check that decides whether the dialog opens;
- not counted in the notice's "left in {name}" lines.

They still go through `planSources()` and `applySources()` with outcome Leave, which touches nothing. Rule-chosen Leaves from the previous note and the inbox are shown as today.

### Which notes are read

- The previous daily note is read as today, however old it is.
- With Look back N > 0 and its dependencies met (below), every other daily note dated on or after the start of the day N days before today, and before today, is read too, except notes dated before `lookBackSince` (see "Not bringing back finished todos"). So with N = 7 on 21 November, notes dated 14 to 20 November. If the previous note is older than the window, no older notes are read (the previous note is the newest note before today).
- Today's note and notes dated after today are never read, as now.
- Window in general: for a series with period `p` (`"day"`, `"week"`, `"month"`), a note is in the window when `date >= today.clone().startOf(p).subtract(N, p)` and `date < today.clone().startOf(p)`. For daily notes `p` is `"day"`. Only daily notes use it now.
- A missing or unreadable daily-notes configuration behaves as now (the rollover already stops before this point).

### Dependencies

Look back applies only when both hold:

- **After rollover** (`onRolloverSourceAction`, through `resolveSourceAction()`) is `"mark"` or `"delete"`. The inbox's own action does not count: the older notes get the previous note's action.
- **Skip todos already in today's note** (`skipExistingTodos`) is on. Copies of the same todo can still exist across notes: from before the user switched from None, or copied by hand on a phone without the plugin. Skip existing drops every copy after the first one inserted, and Mark or Delete then cleans the dropped copies out of their notes (see Source order and copies).

In the settings tab, Look back is a dependent setting: greyed out with a reason when either is off, through `dependentSettingStates()` like the others. A disabled setting keeps its value, so `rolloverDailyNote()` checks the same dependencies at run time and reads no older notes when they are not met. One function decides this (see Components), used by both.

### Not bringing back finished todos

Mark or Delete covers todos the plugin rolled itself. Three cases still leave an open copy of a todo the user has since finished: open copies in notes from before a switch from None; todos copied by hand on a phone without the plugin and finished there; and a source note the rollover had to leave unchanged (edited meanwhile, a failed write, the Templater safeguard) while its todos went into today's note. Copies still open in today's note are no problem (Skip existing drops them and marks the old copy). Two additions handle the finished ones.

**Start date (`lookBackSince`).** The plugin stores the date Look back started applying, and never reads an older note dated before it. This fully covers the switch from None, for finished and deleted todos alike. The previous note is read as always, whatever its date.

- Stored as `"YYYY-MM-DD"` (local date), `""` when unset.
- Shown as a setting of its own, **Read notes from**, a dependent of Look back (greyed with the same reasons when Look back doesn't apply, and when Look back is 0). The user can set it earlier than the day Look back was turned on, to recover todos stranded before that day; the next rollover then reads back to that date, still capped by the Look back window (7 days with a date three weeks back reaches 7 days). A date after today is rejected (not saved); clearing the field means today. Description (builder may polish): "Notes dated before this are not read. Set it earlier to recover todos from before you turned Look back on. That's safe if After rollover was already set to Mark or Delete back then." With "done in a newer note" below, a too-early date can only bring back copies left from None that were later deleted on purpose.
- The settings tab sets it to today whenever a change makes Look back go from not applying to applying (Look back raised from 0, After rollover switched to Mark or Delete while Look back is set, Skip existing turned on while it is set), and clears it when a change makes Look back stop applying, a date the user chose included. A switch from None to Mark while Look back is set therefore starts the window afresh, which is the case this exists for; a user who wants an earlier date sets it again. Editing **Read notes from** itself is not such a change.
- At run time, when Look back applies and `lookBackSince` is empty or not a valid date (a hand-edited `data.json`, settings saved by an older version), the rollover sets it to today, saves the settings, and reads no older notes on that run.
- A note is read when it is in the window and dated on or after `lookBackSince`. So by default, on the day Look back is turned on, no older notes are read, and the reach grows by a day each day up to N. Todos stranded before that day are recovered only when the user moves **Read notes from** earlier.

**Done in a newer note.** An older note's todo is not offered when a newer note has the same todo done. It counts as handled, so Mark or Delete applies to it, as for a skip-existing duplicate.

- "Newer note": today's note, the previous note, and the older notes in the window dated after the note the todo is in.
- "The same todo done": a checkbox line whose marker is one of the effective done markers (`effectiveDoneStatusMarkers()`, so the rollover marker `>` and the cancel marker count: a copy that was forwarded or cancelled in a newer note is handled too), and whose text after the checkbox matches. Text is compared after `stripRolledCount()`, trimmed, ignoring the list marker and indentation.
- Nested items follow Skip existing's rule (README, **Skip todos already in today's note**): the todo counts as handled only when every open todo nested under it is also done in a newer note, or it has none; otherwise the whole item is offered as usual. Under Delete its completed children and plain nested lines are deleted with it, as Skip existing does; under Mark they stay (`retainedLineIndices`).
- Only for older notes (`kind: "earlier"`). The previous note and the inbox behave exactly as now, so the baselines don't move.
- Handled items are kept out of the review the same way as rule-chosen Leaves from older notes (not shown, not counted by `needsReview()`), but their outcome is the source action, not Leave. The notice gets a line for them: "- 2 already done in a newer note." (builder's call on wording).
- Accepted miss: a late addition worded exactly like a todo done in a newer note (a recurring "Call Mom") is not offered. Missing a todo is the cheaper mistake under the first anti-goal.
- Not covered: a todo deleted on purpose from a newer note (see Anti-goals).

### Source order and copies

Sources are, in order: the previous note, the older notes newest first, then the inbox. `insertSources()` inserts them in that order, each against the content the earlier ones left, so with Skip existing the newest copy of a todo is the one that rolls. An older copy is a skip-existing duplicate and is treated as today's duplicates are (README, **Skip todos already in today's note**): it counts as handled, so `writeSource()` marks or deletes it in its note, and `retainedLineIndices` only keeps its nested lines from being moved. Each copy is cleaned up by the first rollover that reads its note; no new rule for older notes. (Checked against the code by the builder review: duplicates stay in `movedLineIndices` / `deleteLineIndices`; the flow test "a duplicate dropped by skip-existing does not move its children" expects `- [>] Standup`.)

### What happens to an older note's todos

The same as for the previous note: they land under the template heading or under their own recreated headings, Move to heading rules apply, `[rolled:: n]` goes up by one with Count rollovers on (no `countRollover: false`), delete removes emptied headings (no `keepHeadings`), a Backlog item gets `[from:: [[{name}]]]`, Cancel marks with the cancel marker, and Mark or Delete runs on Roll and Backlog items.

### Guards

Today's guards compare the inbox and backlog notes with today's note and the previous note. With Look back they cover the older notes too:

- The inbox guard (`inboxPathConflicts()`) also stops when the inbox note is one of the older notes being read. Its notice becomes "The inbox note can't be today's note, a daily note the rollover reads or the backlog note. Change it in settings." (builder's call on exact wording, keeping it one sentence plus "Change it in settings.").
- The backlog guard also stops when the backlog note is one of the older notes being read, with the matching wording change ("…can't be today's note or a daily note the rollover reads…").

In practice both need a note in the daily folder that parses as a date in the window, so they are rare; the guard keeps a source note from also being a write target.

### Settings

- Key `lookBackDays`, default `0`, a whole number from 0 to 366. Stored settings without the key count as 0. Parsed like `staleAfterRollovers` (`parseInt`; anything not a whole number in range is not saved).
- Label: **Look back (days)**. Description (one line, builder may polish): "Also read the daily notes from this many days back, for todos stranded there or added late. 0 reads only the previous day's note."
- Group: **Which todos roll over**, as a dependent of **Skip todos already in today's note** (indented under it). Reason text when greyed: names what to change, for example 'Needs After rollover set to "Mark them" or "Delete them" and Skip todos already in today\'s note turned on.' with shorter texts when only one is missing, in the style of `moveNestedReason()`.
- The group's `?` help gets a paragraph: what Look back does, why it needs Mark or Delete, and that a todo you Leave comes back the next day.
- The variable name says days because daily notes are the only series. Both keys (`lookBackDays` and `lookBackSince`) belong to the daily-note series, stored flat because it is the only one. A later weekly or other dated source gets its own pair, a count in its own periods and its own start date, either as more flat keys or by migrating to a per-source shape (for example `lookBack: { daily: { count, since } }`) at load, as `migrateSourceActionSettings()` does for older keys. `notesInWindow()` and the "done in a newer note" helpers take the series and its notes, so they serve any such source.
- Key `lookBackSince`, default `""`, label **Read notes from**, indented under Look back. Set and cleared as described under "Not bringing back finished todos", and editable by the user there. Seeded with `""` by `loadSettings()`. The input is the builder's call (a text field with a `YYYY-MM-DD` placeholder, or an `<input type="date">`), as long as it parses strictly, rejects dates after today, and treats an empty field as today. It shows the stored date after the settings tab sets it, without re-rendering the page (as `refreshDependents()` updates in place).

### Review dialog

No new UI. Each older note with shown items gets a "From {name}" source row (class `rollover-review-source`) with its own All roll / All leave, as the inbox does; with more than one source the dialog is titled "Roll over todos". Sources without shown items are not listed (already so for sources without items).

### Notices

- `rolloverNotice()`: with more than one contributing source, the rolled line names the inbox as now and sums the older notes into one part: "(3 from earlier notes)", or "(1 from an earlier note)". For example "- 7 todos rolled over (3 from earlier notes, 2 from Inbox)." The "left in {name}" lines name each older note with hand-chosen Leaves, as for the other sources.
- `sourceLabel()` gets a third kind: "the daily note '{name}'" for an older note. `sourceUnchangedNotice()`, `templaterNotice()`, `backlogFailedNotice()` and `sourceWriteFailedNotice()` use it. With only the previous note as source, every notice text stays as it is now.

### Undo

Each older note the rollover changed goes into the undo entry's `sources` list (`{ file, oldContent }`, restored whole, no `keepNewLines`), like the previous note. `UndoModal` lists it by file name as it does every source. The undo window stays 2 minutes.

## Components

Pure, unit-tested:

- `src/daily-notes.js`: `notesInWindow(files, settings, today, moment, { count, period, since })` → `[{ file, date }]` newest first, the daily notes in the window above (excluding today and later, and notes dated before `since` when it is given). Built on `dailyNotes()`. Unit tests cover day, week and month periods, the window's edges, count 0, `since` inside and outside the window, notes in the future, and today's note.
- `lookBackSince` transitions: a pure function (for example `nextLookBackSince(before, after, today)`, returning the new value) used by the settings tab after every change, and the run-time "empty or invalid → today" rule. Unit tests for each transition listed under "Not bringing back finished todos".
- Done in a newer note: a pure helper that, given an older source's sections and the lines of every newer note, returns which of its items are handled (with the nested-items rule). Unit tests: counter stripped, `>` and cancel markers, a different list marker or indentation, an open nested todo that blocks it, a match only in an even older note (not newer) that does not count.
- `src/settings-dependencies.js`: `lookBackDays` and `lookBackSince` in `DEPENDENT_SETTINGS`, with their states and reasons.
- Parsing **Read notes from**: a pure function from the typed text and today to the value to store (a date, `""` for empty, or "not saved" for an invalid or future date), with unit tests.
- A single pure predicate for "Look back applies" (for example `lookBackActive(settings)` in `src/source-action.js` next to `resolveSourceAction()`, or in `rollover-sources.js`; builder's call), used by `dependentSettingStates()` and by `rolloverDailyNote()`.
- `src/rollover-sources.js`: `earlierSource({ file, content, lines, sections, settings })` building an older note's source: `{ key, kind: "earlier", name: file.basename, …, sourceAction: resolveSourceAction(settings) }` with `key` = `file.path + "/"`. The key uses the path, not the basename, because a format with folders (`YYYY/MM/DD`) can give two notes the same basename; it ends in `/`, as `planSources()` requires. Plus: the guard changes, the `sourceLabel()` kind, the notice sum, and keeping hidden items out of `leftCount`.
- Which items are hidden from the review: a pure helper (for example `reviewItems(source, items)` or a flag set in `planSources()`), so `needsReview()`, the dialog and the notice all agree. Builder's call on where, with unit tests in `rollover-sources.test.js` or `rollover-items.test.js`.
- `src/settings-text.js`: label, description, help paragraph.
- `src/rollover-flow.test.js`: flows with older notes as sources: a stranded todo two notes back rolls and is marked; a late addition rolls and is deleted; copies across notes leave one in today's note and the older copies marked; a todo done in a newer note is not inserted and is marked in its older note; a rule-Leave item from an older note is hidden and untouched; a hand-Leave stays open.

Obsidian-facing:

- `src/index.js` `rolloverDailyNote()`: when Look back applies, settle `lookBackSince` (set and save it when empty or invalid), read the notes from `notesInWindow()` other than the previous note, parse each with the same `parse()`, build their sources with `earlierSource()`, find their items done in a newer note (today's note is read for this before the review; the write still re-reads it inside `vault.process()` as now), and put the sources between the previous note and the inbox. A note without open todos is dropped, as now. The early return "no previous note and no inbox" stays: with no previous daily note there is no older one either. Defaults for `lookBackDays` and `lookBackSince` in `loadSettings()`.
- `src/ui/ReviewModal.js`: takes only the shown items per source (or skips hidden ones), and its "All" buttons touch only shown items. The decisions it returns still include the hidden items' Leave.
- `src/ui/RolloverSettingTab.js`: the number field and its dependent state, and `nextLookBackSince()` after every change that can affect whether Look back applies.
- `README.md`: a Look back section (what it reads, the Mark/Delete and Skip existing requirement, that it starts from the day it is turned on and how **Read notes from** reaches further back, and when that is safe, that todos done in a newer note are skipped and marked, Leave meaning "not today" with it on, Cancel to drop a todo, and the one case left from the anti-goals) and a line in the review section. `CLAUDE.md`: the new helpers, the setting, the source kind, and the flow change.

## Testing

Unit tests as listed under Components. End-to-end tests in a new `e2e/look-back.e2e.js` (the plan writes these where it would otherwise write manual checks), using `CHECKLIST_PROFILE` (Mark plus Skip existing) with `lookBackDays` set:

- A todo stranded two notes back (a middle note without it) rolls into today and is marked in its note.
- A late addition to an older note rolls; under Delete it is removed from that note.
- A note just outside the window is not read; one just inside is.
- With After rollover set to Leave them alone, `lookBackDays: 7` reads nothing older (run-time check), and the settings tab shows Look back greyed with its reason (in `e2e/settings.e2e.js`).
- The review shows a "From {date}" group for an older note; a `Tag #habit → Leave` rule's items from older notes are not in it, and the dialog doesn't open for them alone with review set to "always".
- A todo left by hand comes back in the next day's rollover.
- Undo restores every older note the rollover changed.
- A copy of a todo in two notes ends up once in today's note, and the older copy is marked.
- Switching from None: older notes with open copies of todos finished in newer notes, all dated before `lookBackSince`, are not read; turning Look back on in the settings tab sets `lookBackSince` to today (checked in memory and in `data.json`).
- A todo open two notes back but done in the previous note is not offered, not inserted, and is marked in its note.
- Moving **Read notes from** earlier in the settings tab: a todo stranded in a note dated before the day Look back was turned on rolls on the next rollover; a date after today is not saved; switching After rollover to Leave them alone and back resets the date to today.
- With `lookBackDays: 0`, the existing baselines are unchanged (the baseline suite already runs without the key; no new baseline).

The flakiness rule in `CLAUDE.md` applies to the new e2e file: run it twice, every run passing.

## Left to the builder

- Exact notice and reason wording, within the shapes above.
- Where the "Look back applies" predicate and the hidden-items helper live.
- How `ReviewModal` receives shown vs hidden items, as long as the decisions it returns cover every item.
- The order of commits and how the plan splits tasks.
