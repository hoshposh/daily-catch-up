# Inbox Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every rollover also pulls the open todos from one inbox note (a QuickAdd capture target) into today's note, and deletes or marks them in the inbox.

**Architecture:** The inbox is a second source in the list the multi-source foundation introduced (`src/rollover-sources.js`). Three source fields give it its behaviour: `placement` (a heading in today's note, reusing the Move to heading path), `countRollover: false` (no `[rolled:: n]` raised on the way in) and `keepHeadings: true` (Delete keeps the inbox's headings, for QuickAdd's Insert after). Settings, the review dialog's per-source groups, undo text and notices are thin layers over pure helpers.

**Tech Stack:** Plain JavaScript ES modules, Obsidian API, rollup, vitest, the e2e suite in `e2e/`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-inbox-source-design.md` (and `docs/superpowers/specs/2026-11-17-multi-source-foundation-design.md` for the source object).

**Prerequisite:** the multi-source foundation plan (`docs/superpowers/plans/2026-11-17-multi-source-foundation.md`) is merged to `main`. Read `src/rollover-sources.js` before starting: this plan extends `planSources`, `applySources`, `insertSources` and `rolloverNotice`.

## Global Constraints

- With `inboxNotePath` empty (the default), every path behaves exactly as before this plan. The `defaults` and `checklist` e2e baselines pass untouched; never regenerate `e2e/fixtures/expected/`.
- Settings keys and defaults: `inboxNotePath: ""`, `inboxSourceAction: "delete"` (only `"delete"` or `"mark"`; no `"none"`), `inboxHeading: ""` (non-empty text goes through `normalizeHeading()` from `src/backlog.js`).
- Inbox source: `{ key: "inbox/", kind: "inbox", name: file.basename, …, sourceAction: inboxSourceAction, keepHeadings: true, countRollover: false, placement: inboxHeading ? normalizeHeading(inboxHeading) : null }`, always after the previous note's source.
- Mark on the inbox uses `rolloverSourceMarker` and `moveNestedItemsOnMark`, like the previous note.
- A missing inbox note is skipped without a notice. An inbox path equal to today's note, the previous daily note or the backlog note stops the rollover with: `The inbox note can't be today's note, the previous daily note or the backlog note. Change it in settings.`
- Inbox edited during the rollover: left unchanged, with: `Rollover left the inbox note '{name}' unchanged: it was edited while the rollover was running. Its todos were still added to today's note; remove them from the inbox yourself.`
- Notices: rolled line becomes `- {n} todos rolled over ({k} from {name}).` (with the existing trailing space) when the inbox contributed `k > 0`; unchanged otherwise. Leave: one `- {n} left in {name}.` line per source.
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

### Task 2: Placement, no counter, and the inbox notices in the sources module

**Files:**
- Modify: `src/rollover-sources.js`
- Test: `src/rollover-sources.test.js`

**Interfaces:**
- Consumes: the foundation's `planSources`, `applySources`, `rolloverNotice`.
- Produces:
  - `planSources()`: for a source with a `placement` string, each of its items whose `rule.moveTo` is null gets `rule: { ...item.rule, moveTo: source.placement }` (so `applyDecisions()` moves it and the review shows the `→ heading` badge). An item a Move to heading rule already moves keeps its rule's target.
  - `applySources()`: for a source with `countRollover === false`, `perSource[i].noStaleLineIndices` is every one of its items' first line index.
  - `rolloverNotice()`: `sources[i]` gains `kind` and `rolledCount` (todos of that source actually inserted). The rolled line becomes `` `- ${n} todo${s} rolled over (${parts}). ` `` where `parts` joins `` `${k} from ${name}` `` for each source with `kind !== "previous"` and `rolledCount > 0`, with `", "`. No such source: unchanged text.
  - `sourceUnchangedNotice(source) → string`: for `kind: "previous"`, the existing text `"Rollover left the previous day's note unchanged: it was edited while the rollover was running."`; for `kind: "inbox"`, the inbox text in Global Constraints.

- [ ] **Step 1: Write the failing tests**

Reuse Task 2's `previous` / `inbox` sources from the foundation tests, with `inbox.placement = "## Inbox"` and `inbox.countRollover = false` where a test says so.

- `"placement moves inbox items unless a rule already moves them"`: with rules `[{ id: "r", enabled: true, match: "tag", value: "@shop", effect: "move", target: "Shopping" }]` and the inbox lines `["- [ ] Buy milk @shop", "- [ ] Call"]`: inbox items' `rule.moveTo` are `["## Shopping", "## Inbox"]`; the previous note's items' `rule.moveTo` stay `null`.
- `"inbox items are not counted"`: `trackRolloverCount: true` in the plan and insert settings; after `insertSources()`, the previous note's todos carry `[rolled:: 1]` and the inbox's `- [ ] Buy milk` has no counter; an inbox line `- [ ] Old [rolled:: 4]` stays `[rolled:: 4]`.
- `"the rolled line names the inbox"`: `todosAdded: 5`, sources `[{ kind: "previous", name: "2026-11-16", rolledCount: 3, … }, { kind: "inbox", name: "Inbox", rolledCount: 2, … }]` → first line `"- 5 todos rolled over (2 from Inbox). "`; with the inbox's `rolledCount: 0` → `"- 5 todos rolled over. "`.
- `"left lines per source"`: both sources with `leftCount: 1` → lines `"- 1 left in 2026-11-16."` and `"- 1 left in Inbox."`, in that order.
- `"unchanged notices"`: both texts exactly.

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
git commit -m "Support placement, uncounted sources and inbox notices"
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

- [ ] **Step 1: Extend `reviewedRollover()`** with an optional `inbox: { content, action = "delete", heading = "" }`. When given, it builds the inbox source (Global Constraints shape, `name: "Inbox"`), runs it through the same calls as the previous note (with `keepHeadings: true` passed to `applySourceAction()`), and returns `inbox` (its new content) next to `today` and `yesterday`. Also add `templateHeading = "none"` as a parameter if the helper does not have it.

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

- [ ] **Step 1: Build the inbox source in `rolloverDailyNote()`**: a `getInboxPath()` like `getBacklogPath()`; the guard and its notice (Global Constraints); skip silently when the file is missing; read and parse it with the same `getSections()` options as the previous note; append it to `sources` (dropped when it has no open todos). The rollover must no longer return early just because there is no previous daily note or it has no open todos, when the inbox has some.

- [ ] **Step 2: Per-source writes**: pass `keepHeadings: source.keepHeadings ?? false` to `applySourceAction()`; use `sourceUnchangedNotice(source)`; feed `kind` and `rolledCount` into `rolloverNotice()`.

- [ ] **Step 3: Review dialog**: with more than one source, the title and per-source heading rows from Global Constraints; each source's sections follow its row. One source: unchanged.

- [ ] **Step 4: Undo text**: `UndoModal`'s description names the inbox note too ("…the previous day's note and the inbox note if their todos were marked, cancelled or deleted…"); each restored source is listed by name.

- [ ] **Step 5: Docs**: README section "Inbox" (what it does, the QuickAdd setup: Capture to the inbox note, Task on, optionally Insert after a heading; Delete keeps headings; only checkbox lines). `CLAUDE.md`: the three settings keys under **Plugin settings**, the inbox source and its fields, `keepHeadings` on `applySourceAction()`, the rollover flow, and eight settings groups.

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
- `"an inbox that is the backlog note stops the rollover"`: `backlogNotePath: "Inbox.md"`: the guard notice shows; today's note, the previous note and `Inbox.md` are unchanged.
- `"no previous note, inbox still drains"`: `standardNotes()` without the previous note (only the template): today's note gets both inbox todos.
- `"without an inbox note nothing changes"`: no `inboxNotePath`, an `Inbox.md` present: it is untouched.
- `"a capture during the review leaves the inbox alone"`: `runCommand("review-and-rollover")`, `waitForReview()`; append `- [ ] New capture` to `Inbox.md` through `app.vault.process` (with `startAsync()` / `awaitAsync()`); Apply: the inbox-unchanged notice shows, `Inbox.md` still has all three todos, today's note has `Buy milk` and `Call Sam`, and the previous note's source action still ran.

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
