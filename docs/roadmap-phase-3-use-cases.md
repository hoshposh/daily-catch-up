# Phase 3 use cases: more sources

Supplement to [roadmap.md](roadmap.md), Phase 3. These are the workflows each Phase 3 feature would support, gathered on 2026-11-11 to help decide priorities and to check a future design against. They are ideas, not requirements, and none has been tested with users. See also [roadmap-phase-4-use-cases.md](roadmap-phase-4-use-cases.md).

Phase 3 covers two things: gathering from more than one daily note, and pulling from notes that aren't daily notes. Several of these fix problems users can hit today.

Rolling between journals or notes of other frequencies (weekly review, monthly migration, sprints, several journals side by side) was in Phase 3 until later on 2026-11-11. It is now left to the [Journals](https://github.com/srg-kostyrko/obsidian-journal) plugin's own rollover; see [Not planned](roadmap.md#not-planned).

## Recovering after a gap (gather from the last N days)

- **Breaks in the chain.** The rollover only reads the most recent previous note, so todos get stranded whenever a note is created without a rollover:
  - the review dialog is closed on an automatic run and the command is never run that day;
  - the note is created on a phone without the plugin;
  - Templater overwrites the rolled todos.

  The next day's rollover reads the note without them, and they're never seen again.
- **Todos added late.** An action item added on Thursday to Tuesday's meeting section never rolls, because Thursday's note already exists.

## Pulling from other notes

- **Draining a capture inbox.** Todos captured on a phone (with QuickAdd, for example) into `Inbox.md` are pulled into today's note each morning. With the Delete source action, the inbox empties.
- **Bringing items back from the backlog.** Phase 2 parks todos in the backlog note, but nothing ever brings them back. With the backlog as a source, the review dialog could offer "bring back" for parked items, which completes the Phase 2 workflow.
- **Next actions from project notes.** This needs a tag or marker to stop a flood of todos, so it depends on Phase 4's rules, the opposite of the usual order.

## Anti-goal

- **Users of core Daily notes only** see no change unless they turn a new source on.
