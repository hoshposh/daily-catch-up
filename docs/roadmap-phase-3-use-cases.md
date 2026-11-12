# Phase 3 use cases: beyond daily to daily

Supplement to [roadmap.md](roadmap.md), Phase 3. These are the workflows each Phase 3 feature would support, gathered on 2026-11-11 to help decide priorities and to check a future design against. They are ideas, not requirements, and none has been tested with users. See also [roadmap-phase-4-use-cases.md](roadmap-phase-4-use-cases.md).

Phase 3 covers three things besides [Journals](https://github.com/srg-kostyrko/obsidian-journal) support: gathering from more than one note, rolling between notes of different frequencies, and pulling from notes that aren't journals. Several of these fix problems users can hit today.

## Journals support

- **Journals users.** Journals replaces Daily notes, Periodic Notes and Calendar, and identifies notes by frontmatter rather than filename, so this plugin doesn't see its notes today. Support means finding the previous note with `previousNote()` and starting the rollover from its `noteAdded` event (reason `"created"`).
- **Journals with their own frequency.** A journal that isn't daily (weekly, monthly, quarterly, yearly or a custom interval) rolls between its own notes on its own schedule.

## Recovering after a gap (gather from the last N days)

- **Breaks in the chain.** The rollover only reads the most recent previous note, so todos get stranded whenever a note is created without a rollover:
  - the review dialog is closed on an automatic run and the command is never run that day;
  - the note is created on a phone without the plugin;
  - Templater overwrites the rolled todos.

  The next day's rollover reads the note without them, and they're never seen again.
- **Todos added late.** An action item added on Thursday to Tuesday's meeting section never rolls, because Thursday's note already exists.

## Rolling between frequencies

- **Weekly review (rolling up).** At the end of the week, the daily leftovers go into the weekly note instead of the next day's. This is the GTD weekly review, and it suits the review dialog well.
- **Bullet Journal monthly migration.** At the start of a month, carry the open items from last month's log into the new one. This is the plugin's theme at another scale.
- **Weekly-only planners.** People who skip daily notes and plan a week at a time.
- **Sprints.** Journals' custom intervals let unfinished sprint items roll into the next sprint, with the review dialog acting as the carry-or-drop step.
- **Quarterly or yearly goals.** OKRs that carry forward.

## Several journals side by side

- **Work and personal.** Each journal rolls only within itself, so work todos never land in the personal journal.
- **Per-client or per-project logs** kept as separate journals.

## Pulling from other notes

- **Draining a capture inbox.** Todos captured on a phone (with QuickAdd, for example) into `Inbox.md` are pulled into today's note each morning. With the Delete source action, the inbox empties.
- **Bringing items back from the backlog.** Phase 2 parks todos in the backlog note, but nothing ever brings them back. With the backlog as a source, the review dialog could offer "bring back" for parked items, which completes the Phase 2 workflow.
- **Next actions from project notes.** This needs a tag or marker to stop a flood of todos, so it depends on Phase 4's rules, the opposite of the usual order.

## Periodic Notes fallback

- **Users who stay on Periodic Notes** and want weekly or monthly notes by filename. This is the weakest case: Periodic Notes has had no release in years, and Journals can import its settings. Build it only if users ask.
- **Users of core Daily notes only** see no change. That is an anti-goal to keep, not a feature.

## Syncing across devices (to check, not confirmed)

- With sync, today's note can appear on two devices and each may run a rollover. Journals' `"created"` event fires only on the device that created the note, which might prevent the duplicate. Find out how the current 5-second check behaves with synced notes before counting this as a benefit.
