# Inbox note as a source

Design for step 2 of Phase 3 (more sources) in `docs/roadmap.md`: each rollover also pulls the open todos from one inbox note into today's note, and empties the inbox. It builds on `2026-11-17-multi-source-foundation-design.md`, which must be done first. Written on 2026-11-17.

Decided by the user: build it for the QuickAdd capture scenario in `docs/roadmap-phase-3-use-cases.md`. They asked for the design without a question round, so everything else is a call made from the code and the scenario; the ones most likely to matter are listed under [Calls to check](#calls-to-check).

## Intent

People capture todos on the go, often on a phone, into one note. A typical setup is a QuickAdd Capture choice with **Capture to** `Inbox.md`, the **Task** option on (so each capture is written as `- [ ] …`), and often **Insert after** a heading such as `## Captured`. Those todos sit in the inbox until someone copies them over by hand. Daily Catch-Up already moves open todos into today's note every morning; the inbox becomes a second place it gathers from, and the inbox empties as it does.

Success looks like:

- With an inbox note set, the morning rollover puts yesterday's open todos and the inbox's open todos into today's note, and the inbox is left with its headings and nothing else that was pulled.
- QuickAdd keeps capturing into the inbox the next day without any change to its setup.
- Anyone who does not set an inbox note sees no change at all.

## Goals

1. A setting naming the inbox note (empty, the default, turns the feature off).
2. Every rollover (automatic, "Roll over todos now", "Review and roll over todos…") pulls the inbox's open todos, with their nested lines as "Roll over children of todos" says, also when there is no previous daily note or it has no open todos.
3. After the rollover the pulled todos are deleted from the inbox (default) or marked, chosen separately from what happens to the previous day's note.
4. A setting for where inbox todos land in today's note: a heading of their own, or (empty, the default) the same place as rolled todos.
5. The review dialog shows inbox items in their own group, with the same four outcomes.
6. Undo puts the inbox back.
7. Rules apply to inbox todos as to any other.

## Non-goals

- Plain bullets or plain lines as todos. Only checkbox lines are pulled; QuickAdd's Task option writes them. (The README says so.)
- More than one inbox note, or a folder of inbox notes.
- Using the backlog note as the inbox (step 4 of Phase 3 covers the backlog as a source).
- Pulling at any time other than a rollover.
- Clearing completed todos from the inbox. Only pulled lines are removed.
- A `[from:: [[Inbox]]]` field on todos in today's note. Only backlogged items get one, as now.

## Anti-goals

- Any change for users without an inbox note set: every path through the rollover stays exactly as after the foundation work.
- A captured todo lost. Today's note is written before the inbox is touched (as for the previous note), the inbox is left unchanged when it was edited during the rollover, and the Templater safeguard covers the inbox's destructive action.
- Breaking QuickAdd's capture target. Delete never removes the inbox's headings (QuickAdd's Insert after needs its heading to stay), and never deletes the inbox note itself, even when nothing is left in it.

## Design

### Settings

Three keys, defaults in `loadSettings()`:

| Key | Default | Meaning |
|---|---|---|
| `inboxNotePath` | `""` | The inbox note. Empty turns the inbox off. `.md` is added when missing, as for the backlog note. |
| `inboxSourceAction` | `"delete"` | `"delete"` or `"mark"`: what happens to pulled todos in the inbox. |
| `inboxHeading` | `""` | Heading in today's note for inbox todos. Empty: the same place as rolled todos. Text that does not match `/^#{1,6}\s/` gets a `## ` prefix (`normalizeHeading()`). |

There is no "leave them" choice. The inbox would then be pulled again by every rollover, and each todo would land in today's note once per day on top of the copy rolled from yesterday. Mark uses the same marker as the previous note (`rolloverSourceMarker`) and the same "Move nested items when marking" setting.

They form a new settings group, **Inbox**, placed after "What happens to the previous day's note" (it is another note the rollover changes), with a `?` help panel in the style of `settings-text.js`. `inboxSourceAction` and `inboxHeading` are dependent settings of `inboxNotePath` (`DEPENDENT_SETTINGS`, greyed out with "Set an Inbox note to use this." while it is empty).

### The inbox source

When `inboxNotePath` is set, `index.js` adds a second source after the previous note (see the foundation spec's source object):

```js
{
  key: "inbox/",
  kind: "inbox",
  name: file.basename,
  file, content, lines, sections,   // parsed with the same getSections() options as the previous note
  sourceAction: settings.inboxSourceAction,
  keepHeadings: true,
  countRollover: false,
  placement: inboxHeading ? normalizeHeading(inboxHeading) : null,
}
```

- **A missing inbox note** is skipped without a notice: it may not exist until the first capture.
- **An inbox note that is today's note, the previous daily note or the backlog note** stops the rollover with a notice ("The inbox note can't be today's note, the previous daily note or the backlog note. Change it in settings."), like the backlog guard does now.
- **An inbox with no open todos** is dropped from the list, like any source.

### Where inbox todos land

- With `inboxHeading` set, every inbox Roll item gets that heading as its move target, and goes through the existing Move to heading path in `insertSections()`: under the first heading in today's note with that text (any level), or under a new heading at the end; the template heading plays no part. A Move to heading rule that matches the item wins over `inboxHeading`.
- With `inboxHeading` empty, inbox sections go where the previous note's sections go: under the template heading when one is set, otherwise under their own headings, recreated when missing. An inbox with `## Captured` therefore gives today's note a `## Captured` (under the template heading when there is one). Todos above any heading go to the end of the note, or under the template heading.

### The stale counter

Coming from the inbox is not a rollover: inbox items' `[rolled:: n]` is not raised on the way in (`countRollover: false`; the foundation's insert step skips their heads as it skips No stale count items). A todo that already carries a counter keeps it as it is, and `isStale()` still reads it in the review.

### What happens to the inbox

The same steps as the previous note, on the inbox's own line positions, in its own `vault.process()` after the previous note's:

- Roll and Backlog items: `inboxSourceAction` (delete or mark). Cancel items: marked with the cancel marker. Leave items: untouched, so they wait for the next rollover.
- With Delete, headings stay even when all their todos went (`keepHeadings: true`). This needs an option on `applySourceAction()` that skips `removeEmptiedHeadings()` and only removes the lines.
- Empty todos dropped by "Remove empty todos" are deleted with Delete, as on the previous note.
- With "Skip todos already in today's note" on, an inbox todo whose text today's note already has (including one just rolled from the previous note) is not inserted again, and still counts as handled, so Delete removes it from the inbox.
- If the inbox was edited during the rollover (a sync client delivering a new capture, for example), it is left unchanged, with a notice: "Rollover left the inbox note '{name}' unchanged: it was edited while the rollover was running. Its todos were still added to today's note; remove them from the inbox yourself." The previous note is still written.

### Review dialog

With more than one source the dialog is titled "Roll over todos", and each source is a heading row of its own ("From 2026-11-16", "From Inbox") with its own All roll / All leave buttons, followed by that source's sections as today. The "All todos" row at the top covers every source. With one source (the previous note alone, or the inbox alone) it looks exactly as today: titled "Roll over from {name}", no source rows.

An automatic run opens the dialog under the same `reviewOnAutoRollover` rules, considering all items.

### Notices

- The rolled count line counts inbox todos too, and names them: "- 5 todos rolled over (2 from Inbox)." Without inbox todos the line is unchanged.
- Leave: one line per source, "- 1 left in Inbox."
- Backlog items from the inbox get `[from:: [[Inbox]]]`.

### Undo

The inbox is a source note, so the foundation's undo snapshots it when the rollover changed it. `UndoModal`'s description mentions the inbox note alongside the previous day's note.

Undo keeps what arrived in the inbox after the rollover (decided by the user on 2026-11-18, see [Follow-ups](#follow-ups-2026-11-18)).

## Follow-ups (2026-11-18)

Decided by the user after the final review of the inbox branch:

1. **Undo keeps lines added to the inbox since the rollover.** Undo restores notes from a snapshot taken before the rollover, so a capture that syncs into the inbox between the rollover and an undo (the 2-minute window) would be overwritten and lost silently: it was never pulled, and the user did not type it. For the inbox only, the undo entry also keeps the inbox as the rollover left it. On undo, the lines the inbox gained since then are put back on top of the restored text: each run of new lines goes where it sat relative to the lines around it, and new lines next to lines the rollover removed go after those restored lines. A line diff cannot tell an edited line from a removed line plus a new one, so a line edited in the inbox since the rollover comes back twice: the restored original and the edited text, next to it (nothing typed or synced is lost; the user removes one). Lines deleted from the inbox since the rollover come back with the restore, as for other notes. When nothing was added, undo is exactly as before. The undo dialog's line for the inbox says how many added lines are kept. Today's, the previous and the backlog note keep plain snapshot undo.
2. **The inbox and backlog settings follow renames.** When the vault renames or moves the inbox note, the backlog note, or a folder that contains either, the setting is updated to the new path (stored as the full vault path with `.md`) and saved. A path that never matched a note (a typo) still disables the inbox silently; that is out of scope.
3. **Docs for "Move nested items when marking"** (README and `CLAUDE.md`) say it applies to every note set to Mark: the previous day's note and the inbox.

## Testing

- Unit tests (`src/rollover-flow.test.js` through the foundation module, with two sources): inbox only (no previous todos); both sources with skip existing deduping the inbox against the previous note's todos; Delete keeping the inbox's headings; `inboxHeading` placement, with and without a template heading; a Move to heading rule winning over `inboxHeading`; no counter raised for inbox items, and an existing counter kept; Leave keeping a todo in the inbox; Mark on the inbox.
- `applySourceAction()` with the keep-headings option.
- Settings: `settings-dependencies.test.js` for the two dependents, `settings-text.test.js` for the new group.
- e2e (new `e2e/inbox.e2e.js`): a QuickAdd-style `Inbox.md` (`## Captured` with two captured todos) and the standard previous note → `openToday()` → today's note has both sources' todos, the inbox keeps `## Captured` and loses the todos; the review command shows two source groups, and Leave on one inbox item keeps it in the inbox; undo restores the inbox; an inbox set to the backlog note's path refuses with the notice and changes nothing; the Inbox settings group greys out its dependents while the path is empty. The `defaults` and `checklist` baselines must still pass untouched.
- Offer the user a private review clip of the two-source review dialog (`e2e/demos/private/inbox.demo.js`).

## Docs

README: an Inbox section with the QuickAdd setup (Capture to the inbox note, Task on, optionally Insert after a heading). `CLAUDE.md`: settings keys, the inbox source, the rollover flow. Roadmap: tick the inbox box.

## Left to the builder

- Help and description wording, in the style of `settings-text.js`.
- How `placement` is turned into move targets (in the foundation module or in `applyPlan()`), and how `countRollover: false` reaches `planInsert()`.
- The name of the keep-headings option on `applySourceAction()`.

## Calls to check

1. **Delete is the default and "leave them" is not offered**, because the inbox would otherwise be pulled again every day.
2. **Inbox todos land where rolled todos land unless `inboxHeading` is set**, and a set heading behaves like Move to heading (found anywhere in today's note, created at the end, template heading ignored).
3. **Delete keeps the inbox's headings and the note itself**, for QuickAdd's Insert after.
4. **The counter is not raised on the way in.**
5. **The inbox is pulled on automatic runs too**, and also when there is no previous note to roll from.
6. **A missing inbox note is skipped silently**; a misconfigured one (today's note, previous note, backlog note) stops the rollover with a notice.
7. **Mark shares `rolloverSourceMarker` and "Move nested items when marking"** with the previous note instead of having its own.
8. **The Inbox settings group sits after "What happens to the previous day's note".**
