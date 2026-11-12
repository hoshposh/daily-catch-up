# Phase 4 use cases: smart filtering

Supplement to [roadmap.md](roadmap.md), Phase 4. These are the workflows each smart-filtering feature would support, gathered on 2026-11-11 to help decide priorities and to check a future design against. They are ideas, not requirements, and none has been tested with users.

## Why Phase 4 matters

Two existing problems are solved along the way:

- **The stale counter gives false alarms.** Scheduled, waiting and recurring todos all raise `[rolled:: n]` and get flagged stale even though nothing is slipping. Excluding them means the stale flag only marks todos that really are slipping.
- **Rules plug into the existing review dialog.** Tag and heading rules mostly decide an item's default outcome, which `defaultDecisions()` already does, and the dialog still lets the user override them. That makes them fairly cheap to build. Dates and recurrence are the expensive part.

## People who use Obsidian Tasks dates

- **Snoozing a todo.** Someone writes `- [ ] Renew passport ⏳ 2026-12-01`. Today it rolls every day, and with the counter on it gets flagged stale after a week even though nothing slipped. With Phase 4 it stays put and shows up on 1 December, like a GTD tickler file or the Bullet Journal's future log.
- **Start dates (`🛫`).** "Prep Q1 budget 🛫 2027-01-05" doesn't clutter December's notes.
- **Due dates (`📅`).** The review dialog could flag overdue todos, or set their default outcome to Roll even when they're stale.
- **Recurring tasks (`🔁`).** "Water plants 🔁 every week" is copied forward. Completing it in today's note makes Tasks create the next occurrence, while the old copy can still be rolled or left behind, so you end up with two or three copies.
- **Template habit lists.** A missed habit shouldn't add a second "Exercise" next to the one the daily template already added.

Dependency: snoozing properly means finding a todo that sits in a note from three weeks ago, not just the previous note. That needs Phase 3's "gather from the last N days".

Overlap: Tasks users already list "what's scheduled today" with a query block in their daily template. The plugin's value here is keeping old notes and the stale counter clean, not surfacing the todos.

## GTD-style tags (tag rules)

- `#someday` and `#maybe` go straight to the backlog note instead of rolling. That gives a Someday/Maybe list for free.
- `#waiting` (waiting on someone else) doesn't count toward staleness, because the delay isn't yours.
- `#habit` never rolls. A missed habit is just missed.
- `@errands` or `#call` could go to a heading or note for that context.

## Notes with mixed sections (per-heading rules)

- **Meeting notes.** Checkboxes under `## Meetings` are agenda points or attendance and mean nothing tomorrow, so that heading never rolls.
- **Logs.** A `## Log` or `## Gratitude` section that happens to use checkboxes.
- **Routing.** Leftovers from `## Top 3 today` roll into `## Inbox` rather than recreating "Top 3", so they don't claim priority automatically.
- **Work and personal.** `## Work` todos stay off weekend notes. This one is a stretch, since it needs day-of-week rules.

## Custom conventions (regex exclude)

- Checkbox lines used as data, such as `- [ ] @Alice` for attendance or `- [ ] Option A` for a decision list.
- Todos marked with a personal prefix like `WIP:` or `idea:`.
