# Roadmap

Feature ideas for Daily Catch-Up beyond what has shipped. The theme is deliberate migration (the Bullet Journal idea): carry todos forward on purpose, and notice the ones that never get done. Pick work that builds on that theme rather than adding unrelated settings.

Origin: a roadmap conversation before the 2026-11-03 design, recorded here on 2026-11-11. Phases 1 and 2 were designed in `docs/superpowers/specs/2026-11-03-migration-review-and-aging-design.md` and shipped in 1.3.x. On 2026-11-11 the original Phase 3 (smart filtering) and Phase 4 (beyond daily to daily) swapped places, because snoozing by Tasks dates and "roll weekly" rules build on the multi-note sourcing and non-daily notes that Phase 3 now adds.

## Phase 1: Review before rolling (done)

- [x] A review dialog listing the candidate todos grouped by heading, with an outcome per todo (roll, backlog, cancel, leave).
- [x] Used by the "Review and roll over todos…" command; automatic rollover stays automatic unless `reviewOnAutoRollover` says otherwise.
- [x] ~~Dry-run option~~ not built: the review dialog is the preview, and closing it changes nothing.

## Phase 2: Todo aging (done)

- [x] Count how many times a todo has rolled, stored in the line as `[rolled:: n]`.
- [x] Flag todos as stale after N rollovers, in the note and in the review.
- [x] A backlog note for stale or parked todos, with `[from:: [[note]]]` links.

## Phase 3: Beyond daily to daily

Use cases for each item: [roadmap-phase-3-use-cases.md](roadmap-phase-3-use-cases.md).

- [ ] Support the [Journals](https://github.com/srg-kostyrko/obsidian-journal) plugin through its API (`obsidian-journals-api`, `getJournalsApi(app)`). Journals is maintained, replaces Daily notes, Periodic Notes and Calendar, and can import their settings. Findings as of 2026-11-11, from its docs, not tested:
  - Find the previous note with `previousNote(selector, date)` (added in 3.6.0, partly for rollover plugins) instead of walking the vault.
  - Trigger on its `noteAdded` event with reason `"created"` instead of the vault `create` event and the 5-second check.
  - A note's period comes from frontmatter (`journal-date`), not the filename, and a vault can hold several journals of the same type, so a setting has to say which journal(s) to roll over.
  - Roll between notes of any frequency the journal uses: weekly, monthly, quarterly, yearly or custom intervals such as sprints. This covers journals whose frequency differs from the daily note.
  - Journals fills its template before Templater runs; check whether that removes the need for the 3-second Templater wait.
  - Its `"created"` reason fires only on the device that created the note; check whether that stops a second rollover when the note syncs to another device.
- [ ] Several journals side by side (work and personal, per-client logs), each rolling only within itself.
- [ ] Roll up across frequencies: daily leftovers into the weekly note at the end of the week (weekly review), last month's open items into the new monthly log (Bullet Journal monthly migration), unfinished sprint items into the next sprint.
- [ ] Keep Daily notes and Periodic Notes working through `obsidian-daily-notes-interface` as the fallback when Journals is not enabled. Periodic Notes has had no release in years, so add only filename-based weekly and monthly notes on that path, if users ask for them.
- [ ] A "gather from the last N days" mode. Today only the single previous note is read, so todos are stranded whenever a note is created without a rollover (a closed review dialog, a device without the plugin, Templater overwriting the todos), or added to an older note after a newer one exists. Phase 4's snoozing needs this (or Journals' `notesInRange`) to find a todo that sits in an older note.
- [ ] Pull from an inbox note as a source, such as a capture inbox that the Delete source action empties.
- [ ] Pull from the backlog note as a source, with a "bring back" outcome in the review dialog, so parked todos can return.
- [ ] Pull next actions from project notes as a source. Needs a tag or marker rule from Phase 4 to avoid pulling every todo.

## Phase 4: Smart filtering

Use cases for each item: [roadmap-phase-4-use-cases.md](roadmap-phase-4-use-cases.md).

Rules first: they mostly set an item's default outcome, which `defaultDecisions()` already does, and the review dialog still lets the user override them. They also stop the stale counter flagging todos that are not really slipping.

- [ ] Tag rules. Examples: `#someday` / `#maybe` go to the backlog note; `#waiting` doesn't count toward staleness and rolls weekly (into a weekly note, from Phase 3); `#habit` never rolls; `@errands` goes to its own heading or note.
- [ ] Per-heading rules. Examples: never roll `## Meetings` (agenda points and attendance) or `## Log`; always roll `## Inbox`; roll `## Top 3 today` into `## Inbox` instead of recreating its heading.
- [ ] A regex exclude for custom conventions, such as checkbox lines used as data (`- [ ] @Alice`) or a personal `idea:` prefix.

Then Obsidian Tasks dates and recurrence, which build on Phase 3's multi-note sourcing. Tasks users already list scheduled todos with query blocks, so the value here is keeping old notes and the stale counter clean.

- [ ] Respect Tasks dates: don't roll a todo with a future `⏳` scheduled or `🛫` start date, and roll it on that day (a tickler file / Bullet Journal future log). Flag overdue `📅` due dates in the review.
- [ ] Handle `🔁` recurring tasks without creating duplicates, including habit lists the daily template already adds.

## Phase 5: Reliability

- [ ] Replace the 3-second Templater wait with a proper "template finished" check.
- [ ] A persistent rollover log, with a summary note or notice such as "rolled 7, skipped 2, dropped 1".
- [ ] Undo that survives an app restart. It currently lives in memory for 2 minutes.
