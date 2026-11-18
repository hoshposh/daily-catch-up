# Inbox Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every rollover also pulls the open todos from one inbox note (a QuickAdd capture target) into today's note, and deletes or marks them in the inbox.

**Architecture:** The inbox is a second source in the list the multi-source foundation introduced (`src/rollover-sources.js`). Three source fields give it its behaviour: `placement` (a heading in today's note, reusing the Move to heading path), `countRollover: false` (no `[rolled:: n]` raised on the way in) and `keepHeadings: true` (Delete keeps the inbox's headings, for QuickAdd's Insert after; `writeSource()` passes it on, so index.js and the flow tests get it from one place). Settings, the review dialog's per-source groups, undo text and notices are thin layers over pure helpers.

**Tech Stack:** Plain JavaScript ES modules, Obsidian API, rollup, vitest, the e2e suite in `e2e/`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-inbox-source-design.md` (and `docs/superpowers/specs/2026-11-17-multi-source-foundation-design.md` for the source object).

**Prerequisite:** the multi-source foundation plan (`docs/superpowers/plans/2026-11-17-multi-source-foundation.md`) is merged to `main`. Read `src/rollover-sources.js` before starting: this plan extends `planSources`, `applySources`, `insertSources`, `writeSource` and `rolloverNotice`, and adds the notice helpers next to them.

## Global Constraints

- With `inboxNotePath` empty (the default), every path behaves exactly as before this plan. The `defaults` and `checklist` e2e baselines pass untouched; never regenerate `e2e/fixtures/expected/`.
- Settings keys and defaults: `inboxNotePath: ""`, `inboxSourceAction: "delete"` (only `"delete"` or `"mark"`; no `"none"`), `inboxHeading: ""` (non-empty text goes through `normalizeHeading()` from `src/backlog.js`).
- Inbox source: `{ key: "inbox/", kind: "inbox", name: file.basename, …, sourceAction: inboxSourceAction, keepHeadings: true, countRollover: false, placement: inboxHeading ? normalizeHeading(inboxHeading) : null }`, always after the previous note's source.
- Mark on the inbox uses `rolloverSourceMarker` and `moveNestedItemsOnMark`, like the previous note.
- A missing inbox note is skipped without a notice. An inbox path equal to today's note, the previous daily note or the backlog note stops the rollover with: `The inbox note can't be today's note, the previous daily note or the backlog note. Change it in settings.` This inbox guard runs while the sources are built, before the backlog guard, so an inbox that is also the backlog note gets this text, not the backlog one. The backlog guard keeps comparing with today's note and the previous daily note itself (`lastDailyNote`, whether or not it is a source; skipped when there is none).
- Inbox edited during the rollover: left unchanged, with: `Rollover left the inbox note '{name}' unchanged: it was edited while the rollover was running. Its todos were still added to today's note; remove them from the inbox yourself.`
- Source labels (`sourceLabel(source)`): `the previous day's note` for `kind: "previous"`, `the inbox note '{name}'` for `kind: "inbox"`. A list of sources joins them with `" and "` (`the previous day's note and the inbox note 'Inbox'`), in source order.
- Templater safeguard (`templaterNotice(sources)`, every source of the rollover): `Rollover left {labels} unchanged: today's note was modified by another plugin (likely Templater) after the todos were added, and they may be missing. Run 'Roll over todos now' to try again.` With only the previous note this is exactly today's text: `Rollover left the previous day's note unchanged: today's note was modified by another plugin (likely Templater) after the todos were added, and they may be missing. Run 'Roll over todos now' to try again.` With the inbox: `Rollover left the previous day's note and the inbox note 'Inbox' unchanged: today's note was …` (rest unchanged).
- Backlog write failed (`backlogFailedNotice({ backlogPath, error, todosAdded, sources })`): `Rollover couldn't write the backlog note '{backlogPath}' ({error.message ?? error}), so {labels} {was|were} left unchanged.{todaysPart}`, `was` for one source, `were` for more; `todaysPart` is `` ` ${n} todo${n > 1 ? "s were" : " was"} rolled over to today's note.` `` when `todosAdded` (`n`) is above 0, else `""` (index.js passes 0 when nothing was inserted). With only the previous note this is exactly today's text: `Rollover couldn't write the backlog note 'Backlog.md' (disk full), so the previous day's note was left unchanged. 2 todos were rolled over to today's note.` With the inbox: `… so the previous day's note and the inbox note 'Inbox' were left unchanged. …`.
- Source note write failed (`sourceWriteFailedNotice(source, error)`): `Rollover couldn't write {label} ({error.message ?? error}), so it was left unchanged. Its todos were still added to today's note.` The rollover goes on with the next source, and undo still covers what was written.
- Notices: rolled line becomes `- {n} todos rolled over ({k} from {name}).` (with the existing trailing space) when the inbox contributed `k > 0`; unchanged otherwise. Empty todos: one `- {n} empty todos removed. ` line (trailing space, `todo` when `n` is 1) with `n` the sum over the sources whose action is `delete`; no line when `n` is 0; with one contributing source the text is unchanged. Leave: one `- {n} left in {name}.` line per source.
- Review dialog with more than one source: title `Roll over todos`; one heading row per source, `From {name}`, with its own All roll / All leave; the top "All todos" row covers everything. One source: unchanged.
- Settings group: id `inbox`, title `Inbox`, after the `previous` group. Dependents `inboxSourceAction` and `inboxHeading` show `Set an Inbox note to use this.` while `inboxNotePath` is blank.
- DOM via `createEl`/`createDiv`/`createSpan`/`setText` only; CSS only in `styles.css` with theme variables; usable at phone width.
- Commit messages: plain imperative subject, no `Co-Authored-By` or `Claude-Session` lines. Prettier only on files a task creates. `pnpm build` exits 0 after any task touching `src/index.js` or `src/ui/`.

## Review Focus

1. **A QuickAdd capture arriving during the rollover** (the inbox changes between read and write, for example while the review dialog is open): the inbox is untouched and the notice above shows; today's note keeps the pulled todos; the previous note is still written. Test in Task 6 (`"a capture during the review leaves the inbox alone"`).
2. **An inbox whose todos sit above any heading** (QuickAdd's default, appending to the end of the file): they go to the end of today's note, or under the template heading. Test in Task 4.
3. **An inbox todo that today's note already has** (rolled from the previous note the same morning) with skip existing on: inserted once, and still deleted from the inbox. Test in Task 4.
4. **An inbox that is only headings after Delete**: the note and its headings stay. Tests in Tasks 1 and 4.
5. **Inbox only** (no previous daily note, or one without open todos): the inbox is still pulled. Test in Task 4 (pure) and Task 6 (e2e).
6. **A source note that cannot be written** (the inbox's `vault.process()` throws): the error is logged and its notice shows, the other sources are still written, and undo still covers today's note and everything else written. Test in Task 6 (`"a failed inbox write keeps the rollover undoable"`).
7. **Notices with two sources**: the Templater, backlog-failure and empty-todo texts name or count both notes, and stay word for word as on `main` with only the previous note. Tests in Task 2.

---

## Setup

- [ ] Create branch `feat/inbox-source` from `main`.

---

### Task 1: Delete that keeps headings

**Files:**
- Modify: `src/source-action.js` (`applySourceAction()`)
- Test: `src/source-action.test.js`

**Interfaces:**
- Produces: `applySourceAction({ …, keepHeadings = false })`. With `action: "delete"` and `keepHeadings: true`, the lines in `deletedLineIndices` and `skippedLineIndices` are removed and no heading is (`removeEmptiedHeadings()` is skipped). No effect on `"mark"` or `"none"`.

- [ ] **Step 1: Write the failing test**

```js
test("delete can keep headings it empties", () => {
  const content = "## Captured\n- [ ] a\n- [ ] b\n";
  const kept = applySourceAction({ content, action: "delete", rolledLineIndices: [1, 2], keepHeadings: true });
  expect(kept.content).toBe("## Captured\n");
  const dropped = applySourceAction({ content, action: "delete", rolledLineIndices: [1, 2] });
  expect(dropped.content).not.toContain("## Captured");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test -- src/source-action.test.js -t "keep headings"`
Expected: FAIL.

- [ ] **Step 3: Implement the option**

- [ ] **Step 4: Run the file's tests**

Run: `pnpm test -- src/source-action.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/source-action.js src/source-action.test.js
git commit -m "Let delete keep the headings it empties"
```

---

### Task 2: Placement, no counter, kept headings and the inbox notices in the sources module

**Files:**
- Modify: `src/rollover-sources.js`
- Test: `src/rollover-sources.test.js`

**Interfaces:**
- Consumes: the foundation's `planSources`, `applySources`, `insertSources`, `writeSource`, `rolloverNotice`; Task 1's `keepHeadings`.
- Produces:
  - `writeSource()`: passes `keepHeadings: source.keepHeadings ?? false` to `applySourceAction()`. This is the only place it is passed: index.js (Task 5) and `reviewedRollover()` (Task 4) both write sources through `writeSource()`, so neither calls `applySourceAction()` with it.
  - `planSources()`: for a source with a `placement` string, each of its items whose `rule.moveTo` is null gets `rule: { ...item.rule, moveTo: source.placement }` (so `applyDecisions()` moves it and the review shows the `→ heading` badge). An item a Move to heading rule already moves keeps its rule's target.
  - `applySources()`: for a source with `countRollover === false`, `perSource[i].noStaleLineIndices` is every one of its items' first line index.
  - `rolloverNotice()`: `sources[i]` gains `kind` and `rolledCount` (todos of that source actually inserted). The rolled line becomes `` `- ${n} todo${s} rolled over (${parts}). ` `` where `parts` joins `` `${k} from ${name}` `` for each source with `kind !== "previous"` and `rolledCount > 0`, with `", "`. No such source: unchanged text. The empty-todo lines become one line: `removedEmptyTodos` summed over the sources whose `sourceAction` is `"delete"`, worded as in Global Constraints (with one contributing source, the same text as today).
  - `sourceLabel(source) → string`: `"the previous day's note"` or `` `the inbox note '${name}'` ``.
  - `sourceUnchangedNotice(source) → string`: for `kind: "previous"`, the existing text `"Rollover left the previous day's note unchanged: it was edited while the rollover was running."`; for `kind: "inbox"`, the inbox text in Global Constraints.
  - `templaterNotice(sources) → string`, `backlogFailedNotice({ backlogPath, error, todosAdded, sources }) → string` and `sourceWriteFailedNotice(source, error) → string`: the texts in Global Constraints. The first two replace the literals in index.js (Task 5); with only the previous note they return exactly today's text.

- [ ] **Step 1: Write the failing tests**

Reuse Task 2's `previous` / `inbox` sources from the foundation tests, with `inbox.placement = "## Inbox"` and `inbox.countRollover = false` where a test says so.

- `"placement moves inbox items unless a rule already moves them"`: with rules `[{ id: "r", enabled: true, match: "tag", value: "@shop", effect: "move", target: "Shopping" }]` and the inbox lines `["- [ ] Buy milk @shop", "- [ ] Call"]`: inbox items' `rule.moveTo` are `["## Shopping", "## Inbox"]`; the previous note's items' `rule.moveTo` stay `null`.
- `"inbox items are not counted"`: `trackRolloverCount: true` in the plan and insert settings; after `insertSources()`, the previous note's todos carry `[rolled:: 1]` and the inbox's `- [ ] Buy milk` has no counter; an inbox line `- [ ] Old [rolled:: 4]` stays `[rolled:: 4]`.
- `"the rolled line names the inbox"`: `todosAdded: 5`, sources `[{ kind: "previous", name: "2026-11-16", rolledCount: 3, … }, { kind: "inbox", name: "Inbox", rolledCount: 2, … }]` → first line `"- 5 todos rolled over (2 from Inbox). "`; with the inbox's `rolledCount: 0` → `"- 5 todos rolled over. "`.
- `"left lines per source"`: both sources with `leftCount: 1` → lines `"- 1 left in 2026-11-16."` and `"- 1 left in Inbox."`, in that order.
- `"empty todos are summed over deleting sources"`: sources `[{ kind: "previous", sourceAction: "delete", removedEmptyTodos: 1, … }, { kind: "inbox", sourceAction: "delete", removedEmptyTodos: 2, … }]` → exactly one empty-todo line, `"- 3 empty todos removed. "`; with the inbox's `sourceAction: "mark"` → `"- 1 empty todo removed. "`; both `"mark"` → no empty-todo line. Update the foundation's `"each source reports its own empty todos and left todos"` test to this rule (its two empty-todo lines become one `"- 3 empty todos removed. "` line); it only covers more than one source, which no current user has, and the one-source tests stay unchanged.
- `"unchanged notices"`: both texts exactly.
- `"Templater notice names every source"`: `templaterNotice([previous])` is exactly `"Rollover left the previous day's note unchanged: today's note was modified by another plugin (likely Templater) after the todos were added, and they may be missing. Run 'Roll over todos now' to try again."`; `templaterNotice([previous, inbox])` is exactly `"Rollover left the previous day's note and the inbox note 'Inbox' unchanged: today's note was modified by another plugin (likely Templater) after the todos were added, and they may be missing. Run 'Roll over todos now' to try again."`; `templaterNotice([inbox])` starts `"Rollover left the inbox note 'Inbox' unchanged: "`.
- `"backlog failure notice names every source"`: `backlogFailedNotice({ backlogPath: "Backlog.md", error: new Error("disk full"), todosAdded: 2, sources: [previous] })` is exactly `"Rollover couldn't write the backlog note 'Backlog.md' (disk full), so the previous day's note was left unchanged. 2 todos were rolled over to today's note."`; with `todosAdded: 1` it ends `"1 todo was rolled over to today's note."`; with `todosAdded: 0` it ends `"was left unchanged."`; with `sources: [previous, inbox]` and `todosAdded: 2`, exactly `"Rollover couldn't write the backlog note 'Backlog.md' (disk full), so the previous day's note and the inbox note 'Inbox' were left unchanged. 2 todos were rolled over to today's note."`; a string error (`error: "nope"`) reads `(nope)`.
- `"source write failure notice"`: `sourceWriteFailedNotice(inbox, new Error("locked"))` is exactly `"Rollover couldn't write the inbox note 'Inbox' (locked), so it was left unchanged. Its todos were still added to today's note."`, and for `previous` it names `the previous day's note`.
- `"writeSource keeps headings for a source that asks"`: `writeSource()` on `"## Captured\n- [ ] a\n- [ ] b"` with both items rolled and `sourceAction: "delete"`: with `keepHeadings: true` on the source the result is `"## Captured"`, without it the heading goes too.
- `"insertSources reports a missing template heading"`: one entry with a rolled todo, `templateHeading: "## Missing"` and today's note `"# Day\n"`: `templateHeadingNotFound` is `true` and the todo is at the end of the note (the foundation only tests the `false` case).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test -- src/rollover-sources.test.js`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run all unit tests**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rollover-sources.js src/rollover-sources.test.js
git commit -m "Support placement, uncounted sources, kept headings and inbox notices"
```

---

### Task 3: Inbox settings

**Files:**
- Modify: `src/settings-text.js`, `src/settings-dependencies.js`, `src/index.js` (`loadSettings()` defaults only), `src/ui/RolloverSettingTab.js`
- Test: `src/settings-text.test.js`, `src/settings-dependencies.test.js`

**Interfaces:**
- Produces: `SETTING_GROUPS` gains `{ id: "inbox", title: "Inbox", help: [...] }` after `previous`; `SETTING_LABELS` / `SETTING_DESCRIPTIONS` gain `inboxNotePath` ("Inbox note"), `inboxSourceAction` ("After rollover, in the inbox"), `inboxHeading` ("Heading for inbox todos"); `DEPENDENT_SETTINGS` gains `inboxSourceAction` and `inboxHeading`, disabled with reason `"Set an Inbox note to use this."` while `inboxNotePath` is blank.

- [ ] **Step 1: Write the failing tests**

- `settings-text.test.js`: the group test becomes eight groups, with `"inbox"` right after `"previous"`; the help has at least one paragraph that names QuickAdd and says only checkbox lines are pulled.
- `settings-dependencies.test.js`: `"inbox settings need an Inbox note"`: with `inboxNotePath: ""` and `"  "`, both dependents `{ enabled: false, reason: "Set an Inbox note to use this." }`; with `"Inbox.md"`, both enabled.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test -- src/settings-text.test.js src/settings-dependencies.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the text, the dependencies and the defaults**

Help text, in the style of the other groups: the inbox's open todos are pulled by every rollover; set QuickAdd's Capture to this note with Task on, optionally Insert after a heading; Delete removes pulled todos and keeps headings and the note; Mark uses the marker character above; there is no "leave them", because they would be pulled again each day; Heading for inbox todos works like a Move to heading rule, and empty puts them where rolled todos go.

- [ ] **Step 4: Render the group in `RolloverSettingTab.display()`** after the previous-note group: a text setting for `inboxNotePath` (like `backlogNotePath`), a dropdown for `inboxSourceAction` (`delete`: "Delete them", `mark`: "Mark them"), a text setting for `inboxHeading`, the two dependents indented under the path the way `backlogHeading` is under `backlogNotePath`.

- [ ] **Step 5: Build and run the tests**

Run: `pnpm build && pnpm test`
Expected: build exits 0; PASS.

- [ ] **Step 6: Commit**

```bash
git add src/settings-text.js src/settings-dependencies.js src/index.js src/ui/RolloverSettingTab.js src/settings-text.test.js src/settings-dependencies.test.js
git commit -m "Add the Inbox settings group"
```

---

### Task 4: Two-source flow tests

**Files:**
- Modify: `src/rollover-flow.test.js`

**Interfaces:**
- Consumes: Tasks 1–2 and the foundation's `reviewedRollover()` helper.

- [ ] **Step 1: Extend `reviewedRollover()`** with an optional `inbox: { content, action = "delete", heading = "" }`. When given, it builds the inbox source (Global Constraints shape, `name: "Inbox"`), runs it through the same calls as the previous note (one `planSources()` / `applySources()` / `insertSources()` over both sources, then `writeSource()` per source with the same settings object; the source's `keepHeadings: true` reaches `applySourceAction()` through `writeSource()`, so the helper never calls `applySourceAction()` itself), and returns `inbox` (its new content) next to `today` and `yesterday`. Also add `templateHeading = "none"` as a parameter if the helper does not have it.

- [ ] **Step 2: Write the tests** (`describe("inbox")`). The inbox content is QuickAdd-like: `"## Captured\n- [ ] Buy milk\n- [ ] Call Sam\n"` unless a test says otherwise.

- `"inbox only"`: `yesterday: "## Work\n- [x] done\n"`; today gets both inbox todos; `inbox` is `"## Captured\n"`.
- `"both sources, skip existing dedupes the inbox"`: `yesterday: "- [ ] Call Sam\n"`, `skipExisting: true`; today has one `- [ ] Call Sam` line and one `- [ ] Buy milk`; `inbox` is `"## Captured\n"` (the duplicate is still removed).
- `"inbox heading"`: `heading: "Inbox"`, `today: "# Day\n\n## Inbox\n"`: both todos are under `## Inbox`; with `templateHeading: "## Tasks"` and `today: "## Tasks\n"`, they go under a new `## Inbox` at the end, not under `## Tasks`.
- `"a move rule wins over the inbox heading"`: the inbox line `- [ ] Buy milk @shop` and a Move to heading rule `@shop` → `Shopping`: it lands under `## Shopping`, `Call Sam` under `## Inbox`.
- `"todos above any heading"`: inbox `"- [ ] Buy milk\n"`, `templateHeading: "none"`, `today: "# Day\n"`: today ends with `- [ ] Buy milk` (followed by the final newline).
- `"no counter on the way in"`: `track: true`, `yesterday: "- [ ] a\n"`: today has `- [ ] a [rolled:: 1]` and `- [ ] Buy milk` without a counter.
- `"leave keeps an inbox todo"`: decide the inbox's `Call Sam` item `"leave"`: `inbox` is `"## Captured\n- [ ] Call Sam\n"`.
- `"mark"`: `action: "mark"`: `inbox` is `"## Captured\n- [>] Buy milk\n- [>] Call Sam\n"`.
- `"backlog from the inbox names the inbox"`: decide the inbox's `Buy milk` item `"backlog"`: `backlog` contains `- [ ] Buy milk [from:: [[Inbox]]]` (everything else rolls), and `inbox` is `"## Captured\n"`.

- [ ] **Step 3: Run them**

Run: `pnpm test -- src/rollover-flow.test.js -t "inbox"`
Expected: PASS (Tasks 1–2 already built the behaviour). If one fails, fix `src/rollover-sources.js` or `src/source-action.js`, not the expectation, unless the expectation contradicts the spec.

- [ ] **Step 4: Commit**

```bash
git add src/rollover-flow.test.js
git commit -m "Add flow tests for rollovers with an inbox"
```

---

### Task 5: The inbox in the rollover, the review dialog and undo

**Files:**
- Modify: `src/index.js`, `src/ui/ReviewModal.js`, `src/ui/UndoModal.js`, `styles.css` (only if the source rows need it), `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: Tasks 1–3; the foundation's source list in `rolloverDailyNote()`.

- [ ] **Step 1: Build the inbox source in `rolloverDailyNote()`**: a `getInboxPath()` like `getBacklogPath()`; the inbox guard and its notice (Global Constraints), checked while the sources are built: right after the inbox path is resolved and before the backlog guard runs, so an inbox that is also the backlog note shows the inbox text (the e2e test `"an inbox that is the backlog note stops the rollover"` expects it). The inbox guard compares with today's note, `lastDailyNote?.path` and `getBacklogPath()` when a backlog note is set. Skip silently when the file is missing; read and parse it with the same `getSections()` options as the previous note; append it to `sources` (dropped when it has no open todos). The rollover must no longer return early just because there is no previous daily note or it has no open todos, when the inbox has some; the backlog guard then compares with `lastDailyNote?.path` (no previous note: only today's note).

- [ ] **Step 2: Per-source writes**: no `applySourceAction()` call changes in index.js: `writeSource()` (Task 2) already passes the source's `keepHeadings`. Use `sourceUnchangedNotice(source)` for the edited-meanwhile notice, `templaterNotice(sources)` for the Templater safeguard and `backlogFailedNotice({ backlogPath, error, todosAdded: insertedTodos.length > 0 ? todosAdded : 0, sources })` for the backlog failure, in place of their literals; feed `kind` and `rolledCount` into `rolloverNotice()`. Make undo survive a failed write: wrap each source's `vault.process()` in `try`/`catch`; on an error, `console.error("Daily Catch-Up: could not write the source note", source.file.path, error)` and `new Notice(sourceWriteFailedNotice(source, error), 15000)`, the source gets no undo entry and no cancelled count, and the loop goes on with the next source. Put the loop and the final notice in a `try` whose `finally` calls `this.recordUndo(undoHistoryInstance)`, so today's note, the backlog note and the sources already written stay undoable whatever throws. Checked end to end by Task 6's `"a failed inbox write keeps the rollover undoable"`; a flow-level test cannot cover it, because the failure and `recordUndo()` live in index.js around `vault.process()`, which the pure modules never call.

- [ ] **Step 3: Review dialog**: with more than one source, the title and per-source heading rows from Global Constraints; each source's sections follow its row. One source: unchanged.

- [ ] **Step 4: Undo text**: `UndoModal`'s description names the inbox note too ("…the previous day's note and the inbox note if their todos were marked, cancelled or deleted…"); each restored source is listed by name.

- [ ] **Step 5: Docs**: README section "Inbox" (what it does, the QuickAdd setup: Capture to the inbox note, Task on, optionally Insert after a heading; Delete keeps headings; only checkbox lines). `CLAUDE.md`: the three settings keys under **Plugin settings**, the inbox source and its fields, `keepHeadings` on `applySourceAction()` (passed by `writeSource()`), the notice helpers in the `rollover-sources.js` entry, the rollover flow (guard order, a failed source write), and eight settings groups.

- [ ] **Step 6: Build and run the unit tests**

Run: `pnpm build && pnpm test`
Expected: build exits 0; PASS.

- [ ] **Step 7: Commit**

```bash
git add src/index.js src/ui/ReviewModal.js src/ui/UndoModal.js styles.css README.md CLAUDE.md
git commit -m "Pull todos from the inbox note on every rollover"
```

---

### Task 6: End-to-end tests

**Files:**
- Create: `e2e/inbox.e2e.js`
- Modify: `e2e/settings.e2e.js`, `CLAUDE.md` (the e2e test list), `docs/roadmap.md`

**Interfaces:**
- Consumes: the helpers in `e2e/helpers/` (`reset`, `standardNotes`, `openToday`, `waitForNotice`, `waitForIdle`, `runCommand`, `waitForReview`, `reviewRows`, `setOutcome`, `clickButton`, `readNote`, `day`, `openSettings`, `setTextSetting`). Read `e2e/rules.e2e.js` first for the patterns.

- [ ] **Step 1: Write `e2e/inbox.e2e.js`**, each test with `settings: { inboxNotePath: "Inbox.md", … }` and an `Inbox.md` of `"## Captured\n\n- [ ] Buy milk\n- [ ] Call Sam\n"` next to `standardNotes()`:

- `"the morning rollover drains the inbox"`: `openToday()`, `waitForNotice("rolled over")`, `waitForIdle()`: today's note contains `- [ ] Buy milk` and `- [ ] Call Sam` and the previous note's open todos; `Inbox.md` is `"## Captured\n\n"` or `"## Captured\n"` (assert it contains `## Captured` and neither todo).
- `"the review shows each source, and Leave keeps an inbox todo"`: `runCommand("review-and-rollover")`, `waitForReview()`; the dialog title is `Roll over todos`, and it has `From {day(-1)}` and `From Inbox` rows; `setOutcome("Call Sam", "leave")`, Apply: `Inbox.md` still has `- [ ] Call Sam`, not `Buy milk`.
- `"undo restores the inbox"`: roll over, run `undo-rollover`, confirm: `Inbox.md` is back to its original content.
- `"an inbox that is the backlog note stops the rollover"`: `backlogNotePath: "Inbox.md"`: the inbox guard notice shows (`The inbox note can't be today's note, the previous daily note or the backlog note. Change it in settings.`, not the backlog one); today's note, the previous note and `Inbox.md` are unchanged.
- `"no previous note, inbox still drains"`: `standardNotes()` without the previous note (only the template): today's note gets both inbox todos.
- `"without an inbox note nothing changes"`: no `inboxNotePath`, an `Inbox.md` present: it is untouched.
- `"a capture during the review leaves the inbox alone"`: `runCommand("review-and-rollover")`, `waitForReview()`; append `- [ ] New capture` to `Inbox.md` through `app.vault.process` (with `startAsync()` / `awaitAsync()`); Apply: the inbox-unchanged notice shows, `Inbox.md` still has all three todos, today's note has `Buy milk` and `Call Sam`, and the previous note's source action still ran.
- `"a failed inbox write keeps the rollover undoable"`: `runCommand("review-and-rollover")`, `waitForReview()`; in the app, keep `app.vault.process` as `window.__e2eProcess` and replace it with a wrapper that rejects with `new Error("locked")` for `Inbox.md` and calls the original otherwise; Apply. In a `finally`, put the original back (`app.vault.process = window.__e2eProcess`), since the app keeps the patch until it reloads and `reset()` does not undo it. Expect: the notice `Rollover couldn't write the inbox note 'Inbox' (locked), so it was left unchanged. Its todos were still added to today's note.`, `capturedErrors()` holds the logged error, `Inbox.md` unchanged, today's note has both inbox todos, the previous note's source action ran; then `undo-rollover` is available and restores today's note and the previous note.

- [ ] **Step 2: Add to `e2e/settings.e2e.js`**: `"the inbox settings wait for an inbox note"`: open settings; the two dependents are greyed with `Set an Inbox note to use this.`; `setTextSetting("Inbox note", "Inbox.md")`: both enabled, and the page did not jump (`markOutsideRules()` / `markStillThere()`).

- [ ] **Step 3: Run the new and changed files**

Run: `pnpm test:e2e e2e/inbox.e2e.js` then `pnpm test:e2e e2e/settings.e2e.js`
Expected: PASS.

- [ ] **Step 4: Run the full e2e suite**

Run: `pnpm test:e2e`
Expected: all files pass, `baseline.e2e.js` untouched.

- [ ] **Step 5: Docs**: `CLAUDE.md` e2e list gains `e2e/inbox.e2e.js` (one line on what it covers); `docs/roadmap.md`: tick the inbox item.

- [ ] **Step 6: Commit**

```bash
git add e2e/inbox.e2e.js e2e/settings.e2e.js CLAUDE.md docs/roadmap.md
git commit -m "Add end-to-end tests for the inbox source"
```

- [ ] **Step 7: Offer the user a private review clip** of the two-source review dialog: a throwaway `e2e/demos/private/inbox.demo.js` (never committed), recorded with `pnpm demo inbox`, handing over the GIF's absolute path.
