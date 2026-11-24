# Roadmap

Feature ideas for Daily Catch-Up beyond what has shipped. The theme is deliberate migration (the Bullet Journal idea): carry todos forward on purpose, and notice the ones that never get done. Pick work that builds on that theme rather than adding unrelated settings.

Origin: a roadmap conversation before the 2026-11-03 design, recorded here on 2026-11-11. Phases 1 and 2 were designed in `docs/design/2026-11-03-migration-review-and-aging-design.md` and shipped in 1.3.x. On 2026-11-11 the original Phase 3 (smart filtering) and Phase 4 (beyond daily to daily) swapped places, because snoozing by Tasks dates and "roll weekly" rules build on the multi-note sourcing and non-daily notes that Phase 3 now adds. Later on 2026-11-11, Journals support and the other non-daily items were taken off Phase 3 (see [Not planned](#not-planned)), and Phase 3 became "More sources".

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

### Sizing and order (2026-11-17)

Every item below reads todos from a second note, and the rollover is written around exactly one: line positions (`incompleteLineIndices`, `movedLineIndices`, …) refer to the previous daily note, which gets one `vault.process()` with one "edited meanwhile" check; undo has one `previousDay` slot; the backlog's `[from:: [[…]]]` takes one source name; `getLastDailyNote()` returns one file; the review dialog is titled after one note. So Phase 3 starts with a refactor that the items share. Order, with sizes (S < M < L):

1. **Multi-source foundation (M–L).** A rollover reads a list of sources, holding only the previous daily note, with no change in behaviour (the e2e baselines prove it). Design: [2026-11-17-multi-source-foundation-design.md](design/2026-11-17-multi-source-foundation-design.md).
2. **Inbox note as a source (S–M on the foundation).** The simplest real second source, and it tests the foundation's multi-note writes, undo and review grouping without the dedupe problem of item 4. Design: [2026-11-17-inbox-source-design.md](design/2026-11-17-inbox-source-design.md).
3. **Own the daily-notes lookup (S).** Replace `obsidian-daily-notes-interface` (a personal package: no release from 2021-09 to 2026-05; 0.9.4 pins its `obsidian` dependency to a GitHub tarball) with a small `src/daily-notes.js`: a pure, unit-tested part (a note's date from its path, folder and format; sorting) and a thin part that reads the Daily Notes or Periodic Notes settings through `internalPlugins`, as the package does. It also replaces `getLastDailyNote()`'s own path regex in `index.js`, so one piece of code decides which files are daily notes. "Gather from the last N days" builds on it. While there, pin the plugin's own `obsidian` dependency to an npm version instead of `obsidian-api/tarball/master`.
4. **Gather from the last N days (L), shipped as Look back.** The spec settled the open question (what counts as already handled): Look back needs After rollover set to Mark or Delete and Skip todos already in today's note, so an open todo in an older note is one that never rolled; it starts from the day it is turned on (`lookBackSince`, shown as Read notes from); and a todo done in a newer note is skipped and marked. Each older daily note is a source of its own (`kind: "earlier"`). Design: [2026-11-21-look-back-design.md](design/2026-11-21-look-back-design.md). Phase 4's Tasks dates can now build on it.
5. **Backlog as a source with "bring back" (M), shipped as Bring back from backlog.** Its own command rather than a group in the review, so the backlog is never written twice in one run and the morning review stays short; every todo starts on Stay. Design: [2026-11-23-backlog-bring-back-design.md](design/2026-11-23-backlog-bring-back-design.md). Follow-ups: a filter field in the dialog should real backlogs get long; offering the backlog inside "Review and roll over todos…" too.
6. **Next actions from project notes (L+).** Needs a filtering hook that runs before items are formed (rules only act on items already read), a source action that suits project notes (Delete and Mark don't; None re-pulls the same todo every day unless deduped across sources), and reading many notes per rollover. Obsidian Tasks query blocks already list next actions from project notes and complete the original; copies in the daily note lose that link. Decide whether it is still worth it, or belongs under [Not planned](#not-planned), before designing it.

- [x] Multi-source foundation (see above).
- [x] Own the daily-notes lookup (see above).
- [x] A "gather from the last N days" mode, shipped as **Look back** (see above). Before it, only the single previous note was read, so todos were stranded whenever a note was created without a rollover (a closed review dialog, a device without the plugin, Templater overwriting the todos), or added to an older note after a newer one existed. Phase 4's snoozing needs it to find a todo that sits in an older note. Design: [2026-11-21-look-back-design.md](design/2026-11-21-look-back-design.md).
- [x] Pull from an inbox note as a source, such as a capture inbox that the Delete source action empties. Designed for the QuickAdd capture scenario (see the spec above).
- [x] Pull from the backlog note as a source, so parked todos can return: shipped as the **Bring back from backlog…** command (see above).
- [ ] Pull next actions from project notes as a source. Needs a tag or marker rule from Phase 4 to avoid pulling every todo. Phase 4's rules now exist, but they only act on todos already read from the previous note (`isIgnoredByRules()` in the parser, `ruleResult()` per item). Choosing which todos a source contributes needs a new hook, for example a rule effect or a per-source match evaluated before items are formed.

## Phase 4: Smart filtering

Use cases for each item: [roadmap-phase-4-use-cases.md](roadmap-phase-4-use-cases.md).

Rules first: they mostly set an item's default outcome, which `defaultDecisions()` already does, and the review dialog still lets the user override them. They also stop the stale counter flagging todos that are not really slipping.

Rules shipped in 1.4.0 (released 2026-11-17). They are one rule list in a Rules settings section, designed in `docs/design/2026-11-12-rules-design.md`, with unit tests in `src/rules.test.js` and e2e tests in `e2e/rules.e2e.js` and `e2e/settings.e2e.js`. Each rule matches by tag, heading or regex and sets the default outcome, marks the line as not a todo, exempts it from the stale counter, or moves it to another heading in today's note.

- [x] Tag rules. Examples: `#someday` / `#maybe` go to the backlog note; `#waiting` doesn't count toward staleness; `#habit` never rolls; `@errands` goes to its own heading. Moving to another note was left out: it needs a second write target with its own undo snapshot.
- [x] Per-heading rules. Examples: never roll `## Meetings` (agenda points and attendance) or `## Log`; always roll `## Inbox`; roll `## Top 3 today` into `## Inbox` instead of recreating its heading.
- [x] A regex exclude for custom conventions, such as checkbox lines used as data (`- [ ] @Alice`) or a personal `idea:` prefix. A regex rule can have any effect, not only exclude.

Follow-ups from the final review of the rules branch (graded minor, none blocked the release):

- [x] Moved todos keep their indentation. A todo that sat under a plain bullet (`- Garden` / `    - [ ] buy soil #errands`) landed indented under another moved todo, and the next rollover treated the two as one item. The cause predated rules (within one section, `- [ ] a` / `- Garden` / `    - [ ] soil` landed `soil` under `a`). Fixed for every rolled todo, not only moved ones: `rebaseSections()` starts a todo at column 0 when the line it was nested under does not go to the same place (a plain bullet, a done todo, a Leave or Cancel item, another heading), with its nested lines shifted by as much. A todo nested under one that rolls with it keeps its indentation, so the `defaults` baseline is unchanged. The backlog note already dedented each item.
- [x] Tag values are not fully normalised: `##someday` was kept as typed and never matched `#someday`, and a bare `#` or `@`, or a tag with spaces (`#some day`), passed validation. `normalizeTag()` now strips all leading `#`s, and `ruleProblem()` rejects an empty or space-containing tag with "Enter a tag."
- [x] A hand-edited effect such as `"toString"` showed function source in its settings row, because `EFFECT_LABELS[rule.effect]` read the prototype chain. `ruleSummary()` now shows `?` for any effect not in `EFFECTS`.
- [x] Editing a hand-edited, malformed rule in `RuleModal` was confusing: `value: 42` showed an empty field (the e2e test found it was not even shown as "42") with Save disabled, and a missing `match` left the dropdown blank. `ruleDraft()` now coerces the draft when the dialog opens (value and target to text, an unknown match or effect to Tag / Roll), so the dialog shows what Save stores.
- [x] Add unit flow tests (`src/rollover-flow.test.js`) for delete and mark on a moved item with skipped completed or dropped empty children, and for skip-existing on a moved section.
- [ ] Two headings the rollover appends to today's note have no blank line between them (`## A` / blank / `- [ ] a` / `## B`), although `leadingNewLine` puts one before the first. It predates rules (found while writing the flow tests above, which keep the current output).

Known limitations, accepted on purpose:

- No badge names a No stale count rule in the review, even when it turns a would-be Backlog default into Roll. The spec only has badges for outcome and move rules. The `[rolled:: n]` counter is still visible on the line.
- Deleting a rule in settings does not ask for confirmation.
- A tag right after `(`, as in `(#someday)`, is not matched. Tag rules use the same tag start as `hasRolledMarker()`.
- A move target heading inside a fenced code block in today's note is still found, like the existing heading lookup.
- A hand-typed `"enabled": "false"` (a string) counts as switched on.

Then Obsidian Tasks dates and recurrence, which build on Phase 3's multi-note sourcing. Tasks users already list scheduled todos with query blocks, so the value here is keeping old notes and the stale counter clean.

- [ ] Respect Tasks dates: don't roll a todo with a future `⏳` scheduled or `🛫` start date, and roll it on that day (a tickler file / Bullet Journal future log). Flag overdue `📅` due dates in the review.
- [ ] Handle `🔁` recurring tasks without creating duplicates, including habit lists the daily template already adds.

## Phase 5: Reliability

- [ ] Replace the 3-second Templater wait with a proper "template finished" check.
- [ ] A persistent rollover log, with a summary note or notice such as "rolled 7, skipped 2, dropped 1".
- [ ] Undo that survives an app restart. It currently lives in memory for 2 minutes.
- [ ] Check whether Delete loses nested lines with skip-existing. When a todo is skipped because today's note already has it (`skipExistingTodos`), its nested lines are not carried over. Under Mark they stay in the previous note under the marked todo, so nothing is lost (the `checklist` e2e baseline encodes this). The 2026-11-08 manual checklist recorded that under Delete, a plain nested note under such a todo was deleted with it, which would lose it from both notes. Write an e2e test for Delete with skip-existing first, to see whether that happens. Confirm with the maintainer before starting a fix branch: the follow-up was first agreed on a wrong claim that Mark loses the lines too. If a fix changes an e2e baseline, show the diff before regenerating `e2e/fixtures/expected/`.

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
