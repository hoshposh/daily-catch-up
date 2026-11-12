# Roadmap

Feature ideas for Daily Catch-Up beyond what has shipped. The theme is deliberate migration (the Bullet Journal idea): carry todos forward on purpose, and notice the ones that never get done. Pick work that builds on that theme rather than adding unrelated settings.

Origin: a roadmap conversation before the 2026-11-03 design, recorded here on 2026-11-11. Phases 1 and 2 were designed in `docs/superpowers/specs/2026-11-03-migration-review-and-aging-design.md` and shipped in 1.3.x. On 2026-11-11 the original Phase 3 (smart filtering) and Phase 4 (beyond daily to daily) swapped places, because snoozing by Tasks dates and "roll weekly" rules build on the multi-note sourcing and non-daily notes that Phase 3 now adds. Later on 2026-11-11, Journals support and the other non-daily items were taken off Phase 3 (see [Not planned](#not-planned)), and Phase 3 became "More sources".

## Phase 1: Review before rolling (done)

- [x] A review dialog listing the candidate todos grouped by heading, with an outcome per todo (roll, backlog, cancel, leave).
- [x] Used by the "Review and roll over todos…" command; automatic rollover stays automatic unless `reviewOnAutoRollover` says otherwise.
- [x] ~~Dry-run option~~ not built: the review dialog is the preview, and closing it changes nothing.

## Phase 2: Todo aging (done)

- [x] Count how many times a todo has rolled, stored in the line as `[rolled:: n]`.
- [x] Flag todos as stale after N rollovers, in the note and in the review.
- [x] A backlog note for stale or parked todos, with `[from:: [[note]]]` links.

## Phase 3: More sources

Use cases for each item: [roadmap-phase-3-use-cases.md](roadmap-phase-3-use-cases.md).

- [ ] A "gather from the last N days" mode. Today only the single previous note is read, so todos are stranded whenever a note is created without a rollover (a closed review dialog, a device without the plugin, Templater overwriting the todos), or added to an older note after a newer one exists. Phase 4's snoozing needs this to find a todo that sits in an older note.
- [ ] Pull from an inbox note as a source, such as a capture inbox that the Delete source action empties.
- [ ] Pull from the backlog note as a source, with a "bring back" outcome in the review dialog, so parked todos can return.
- [ ] Pull next actions from project notes as a source. Needs a tag or marker rule from Phase 4 to avoid pulling every todo.

## Phase 4: Smart filtering

Use cases for each item: [roadmap-phase-4-use-cases.md](roadmap-phase-4-use-cases.md).

Rules first: they mostly set an item's default outcome, which `defaultDecisions()` already does, and the review dialog still lets the user override them. They also stop the stale counter flagging todos that are not really slipping.

- [ ] Tag rules. Examples: `#someday` / `#maybe` go to the backlog note; `#waiting` doesn't count toward staleness; `#habit` never rolls; `@errands` goes to its own heading or note.
- [ ] Per-heading rules. Examples: never roll `## Meetings` (agenda points and attendance) or `## Log`; always roll `## Inbox`; roll `## Top 3 today` into `## Inbox` instead of recreating its heading.
- [ ] A regex exclude for custom conventions, such as checkbox lines used as data (`- [ ] @Alice`) or a personal `idea:` prefix.

Then Obsidian Tasks dates and recurrence, which build on Phase 3's multi-note sourcing. Tasks users already list scheduled todos with query blocks, so the value here is keeping old notes and the stale counter clean.

- [ ] Respect Tasks dates: don't roll a todo with a future `⏳` scheduled or `🛫` start date, and roll it on that day (a tickler file / Bullet Journal future log). Flag overdue `📅` due dates in the review.
- [ ] Handle `🔁` recurring tasks without creating duplicates, including habit lists the daily template already adds.

## Phase 5: Reliability

- [ ] Replace the 3-second Templater wait with a proper "template finished" check.
- [ ] A persistent rollover log, with a summary note or notice such as "rolled 7, skipped 2, dropped 1".
- [ ] Undo that survives an app restart. It currently lives in memory for 2 minutes.

## Not planned

Journals support and rolling between notes other than daily notes. Decided on 2026-11-11, after reading the [Journals](https://github.com/srg-kostyrko/obsidian-journal) source.

Journals 3.6.0 (2026-11-01) has its own rollover: a "Roll over unfinished tasks" command and a per-journal **Automatic rollover** setting, for journals of any frequency (weekly, monthly, custom intervals such as sprints). It rolls only the headings its listing filter names, lands each task under the heading of the same name when the new note has it, looks back over more than one note, and by default copies the task and tags the original `#rolled`. A second rollover engine for journals would duplicate that, so Daily Catch-Up stays with core Daily notes. These items came off Phase 3 with it:

- Journals support through its API (`previousNote()`, the `noteAdded` event).
- Several journals side by side (work and personal, per-client logs).
- Rolling up across frequencies: daily leftovers into the weekly note, monthly migration, sprint to sprint.
- The Periodic Notes fallback, which only made sense alongside Journals support.

What Daily Catch-Up does that Journals' rollover does not, as candidates to contribute to Journals instead:

- Recreating the headings a task sat under, with their full ancestry, when the new note lacks them. Journals puts a task under one target heading, or at the end, when the new note doesn't have the heading.
- A review step before rolling, with an outcome per item (roll, backlog, cancel, leave).
- A rollover counter on each task, and stale flags once it reaches a limit.
- A backlog note for parked or stale tasks, with a link back to the source note.

Overlap when a Journals daily journal and Daily Catch-Up use the same folder:

- Daily Catch-Up skips todos tagged `#rolled` (Journals' default marker), and everything nested under them, so it does not roll again what Journals rolled. The marker is fixed. If Journals support or official recognition is ever added, surface it as a setting, or read Journals' configured marker through its API (the API does not expose it as of 3.6.0).
- The other direction is not handled: Journals does not recognise the todos Daily Catch-Up rolled (with the default source action they stay open, and `[rolled:: n]` stops Journals' duplicate check from matching them), so it would roll them again. The README says to let only one plugin roll over each folder.
- Not built: a warning when a Journals daily journal and core Daily notes write to the same folder. Journals' API does not give a journal's folder.
