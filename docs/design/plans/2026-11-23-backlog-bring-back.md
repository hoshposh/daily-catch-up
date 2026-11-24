# Bring Back from Backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Bring back from backlog…" command that lists the backlog note's open todos in the review dialog, all on Stay, and moves the ones the user picks into today's note.

**Architecture:** The backlog becomes a source of `kind: "backlog"` in `rollover-sources.js`, planned, applied and written by the same calls as the rollover's sources. The part of `rolloverDailyNote()` after the review moves into a shared `writeRollover()` method first (a pure refactor), which the new `bringBack()` method then calls with the Templater wait off. `ReviewModal` gets a bring-back form (labels, title, summary, "from" badge).

**Tech Stack:** Obsidian plugin API, plain JavaScript (ES modules bundled by rollup), vitest for unit tests, the `e2e/` vitest suite driving Obsidian through its CLI.

**Spec:** `docs/design/2026-11-23-backlog-bring-back-design.md`

## Global Constraints

- Command id `bring-back-from-backlog`, name `Bring back from backlog…` (with the `…` character, as "Review and roll over todos…").
- No new settings keys.
- The rollover's behaviour does not change: `pnpm test` and the whole `pnpm test:e2e` suite (including `e2e/baseline.e2e.js`) pass unchanged after every task. Never regenerate `e2e/fixtures/expected/`.
- Outcome keys stay `roll` / `leave` / `cancel`; only the dialog's labels differ (Bring back / Stay / Cancel). `backlog` is never offered for a backlog item.
- The backlog note is only ever changed by deleting Bring back items (with their nested lines) and marking Cancel items. Stay items, empty todos, completed todos and Not a todo lines are never removed.
- User-facing strings are copied verbatim from the tasks below.
- Commit messages: a plain sentence in the style of `git log`, no `Co-Authored-By` or `Claude-Session` lines.
- e2e tests need Obsidian running with `e2e-vault` open. If it isn't, stop and ask the user to open it; never skip the e2e step.

## Review Focus

1. A backlog todo with an Obsidian Tasks date after its `[from:: …]` field (`- [ ] Pay tax [from:: [[2026-11-01]]] 📅 2026-12-01`) comes back with the date intact and one space before it. Pinned in Task 2.
2. A backlog note with CRLF line endings keeps them, and the stripped head keeps its `\r`. Pinned in Tasks 2 and 3.
3. The same todo parked twice (two lines differing only in `[from:: …]`), both brought back with Skip todos already in today's note on: today's note gets it once, the backlog loses both. Pinned in Task 3.
4. An empty todo (`- [ ] `) at the top level of the backlog, with Remove empty todos on, survives a bring back of its neighbours, and so does a completed child under it. Pinned in Task 3.
5. A `[from:: [[2026-11-01|Monday]]]` link with an alias shows the badge "from 2026-11-01". Pinned in Task 2.

---

### Task 1: Share the write stage between commands (refactor, no behaviour change)

**Files:**
- Modify: `src/index.js` (`rolloverDailyNote()`, from `const applied = applySources(…)` to the end of the method; and the `parse` closure near its top)

**Interfaces:**
- Produces:
  - `parseNote(lines: string[]): object[]`: a method on the plugin returning `getSections()` with the options the rollover uses today (the current `parse` closure, `rules` read from `this.settings.rules ?? []`).
  - `async writeRollover({ file, sources, plans, decisions, backlogPath, templaterGuard, buildNotice, undoKind })`: a method on the plugin. `file` is today's note (TFile); `sources`, `plans`, `decisions` as now; `backlogPath` a path or `null`; `templaterGuard: boolean`; `buildNotice(summary) => string` where `summary = { templateHeadingNotFound, todosAdded, todosAlreadyPresent, doneElsewhereCount, outcomeCounts, cancelledCount, backlogPath, perSource, insertedPerSource, plans }`; `undoKind: "rollover" | "bring-back"` stored as `kind` on the undo entry. Returns nothing; shows notices and calls `recordUndo()` in its `finally`, exactly as the current code does.
  - With `templaterGuard: true` it behaves exactly as the current code. With `false`: no Templater wait or check, and today's note is always snapshotted for undo (the `!this.isTemplaterEnabled()` condition is skipped).

- [ ] **Step 1: Record the baseline.** Run `pnpm test`, `pnpm build`, `pnpm test:e2e`. Expected: all pass. If any fail before you change anything, stop and report.

- [ ] **Step 2: Extract `parseNote()` and `writeRollover()`.** `rolloverDailyNote()` calls `writeRollover({ …, templaterGuard: true, undoKind: "rollover", buildNotice: (s) => rolloverNotice({…same arguments as today, built from s…}) })`. Move the undo instance setup into `writeRollover()`. Move code, don't rewrite it: comments go with their lines.

- [ ] **Step 3: Verify nothing changed.** Run `pnpm test`, `pnpm build`, `pnpm test:e2e`. Expected: the same passes as Step 1, no test file edited.

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "Move the rollover's write stage into writeRollover() for reuse"
```

---

### Task 2: Pure helpers for the `[from:: …]` field and the bring-back summary

**Files:**
- Modify: `src/rolled-count.js`, `src/rollover-items.js`
- Test: `src/rolled-count.test.js`, `src/rollover-items.test.js`

**Interfaces:**
- Produces:
  - `stripFromField(line: string): string` in `rolled-count.js`: removes every `[from:: …]` field (the value may hold one `[[…]]` link) and the whitespace before it.
  - `fromNote(line: string): string | null` in `rolled-count.js`: the link target of the first `[from:: [[X]]]` or `[from:: [[X|alias]]]` field, else `null`.
  - `summarizeBringBack(decisions: Record<string, string>): string` in `rollover-items.js`.

- [ ] **Step 1: Write the failing tests**

```js
describe("stripFromField", () => {
  test.each([
    ["- [ ] Learn Rust [from:: [[2026-11-01]]]", "- [ ] Learn Rust"],
    ["- [ ] Pay tax [from:: [[2026-11-01]]] 📅 2026-12-01", "- [ ] Pay tax 📅 2026-12-01"],
    ["- [ ] Call Sam [from:: [[Inbox]]] ^abc", "- [ ] Call Sam ^abc"],
    ["- [ ] A [rolled:: 2] [from:: [[d]]]", "- [ ] A [rolled:: 2]"],
    ["- [ ] Mon [from:: [[2026-11-01|Monday]]]\r", "- [ ] Mon\r"],
    ["- [ ] Typed [from:: somewhere]", "- [ ] Typed"],
    ["- [ ] Plain", "- [ ] Plain"],
  ])("%s", (line, expected) => {
    expect(stripFromField(line)).toBe(expected);
  });
});

describe("fromNote", () => {
  test("the linked note", () => {
    expect(fromNote("- [ ] Learn Rust [from:: [[2026-11-01]]]")).toBe("2026-11-01");
  });
  test("an alias is left out", () => {
    expect(fromNote("- [ ] Mon [from:: [[2026-11-01|Monday]]]")).toBe("2026-11-01");
  });
  test("no field, or a field without a link", () => {
    expect(fromNote("- [ ] Plain")).toBeNull();
    expect(fromNote("- [ ] Typed [from:: somewhere]")).toBeNull();
  });
});

describe("summarizeBringBack", () => {
  test("counts in the order bring back, cancelled, stay", () => {
    expect(summarizeBringBack({ a: "roll", b: "leave", c: "leave", d: "cancel" }))
      .toBe("1 to bring back, 1 cancelled, 2 stay");
  });
  test("only stay", () => {
    expect(summarizeBringBack({ a: "leave" })).toBe("1 stay");
  });
  test("nothing", () => {
    expect(summarizeBringBack({})).toBe("nothing to do");
  });
});
```

- [ ] **Step 2: Run them to see them fail.** `pnpm test -- src/rolled-count.test.js src/rollover-items.test.js`. Expected: FAIL, the functions are not exported.

- [ ] **Step 3: Implement the three functions.** For the field, a pattern such as `/\s*\[from::(?:[^\[\]]|\[\[[^\]]*\]\])*\]/g` matches both forms. `summarizeBringBack()` mirrors `summarizeDecisions()` with the parts `[roll, "to bring back"]`, `[cancel, "cancelled"]`, `[leave, "stay"]`.

- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS, and the rest of `pnpm test` still passes.

- [ ] **Step 5: Commit**

```bash
git add src/rolled-count.js src/rolled-count.test.js src/rollover-items.js src/rollover-items.test.js
git commit -m "Add helpers to strip and read the from field and to summarize a bring back"
```

---

### Task 3: The backlog source

**Files:**
- Modify: `src/rollover-items.js` (`applyDecisions()`), `src/rollover-plan.js` (`applyPlan()`), `src/rollover-sources.js` (`backlogSource()`, `planSources()`, `applySources()`, `sourceNeedsWrite()`, the header comment's list of kinds)
- Test: `src/rollover-sources.test.js`, `src/rollover-flow.test.js`

**Interfaces:**
- Consumes: `stripFromField()` (Task 2).
- Produces:
  - `backlogSource({ file, content, lines, sections })` → `{ key: "backlog/", kind: "backlog", name: file.basename, file, content, lines, sections, sourceAction: "delete", keepHeadings: true, countRollover: false, flatten: true }`.
  - `planSources()` for a `"backlog"` source: every item's decision `"leave"`; each item's `rule` keeps `moveTo` (and `moveRule`, if present) but has no `outcome` / `outcomeRule`.
  - `applyPlan({ plan, decisions, deleteOnlyChosen = false })`: with `deleteOnlyChosen`, `deleteLineIndices` holds only the lines of Roll and Backlog items plus the dropped empty todos that belong to them, and `skippedLineIndices` only the skipped completed children that belong to them. Without it, unchanged. How `applyDecisions()` exposes the ownership needed is up to you.
  - `applySources()` for a `"backlog"` source: passes `deleteOnlyChosen: true`; in its `rolledSections`, every head line of a Roll item goes through `stripFromField()`; with `source.flatten`, every rolled section without `moveTo` gets `headingPath: []`.
  - `sourceNeedsWrite()` treats `"backlog"` like `"earlier"` (written only when it has moved, cancelled, deleted or skipped lines).

- [ ] **Step 1: Write the failing unit tests in `rollover-sources.test.js`**

  - `backlogSource()` returns the object above for `file = { basename: "Backlog" }`.
  - `planSources()` with one backlog source of two todos, and a rule `{ id: "r", enabled: true, match: "tag", value: "#someday", effect: "roll" }` matching one of them: `decisions` are all `"leave"`, and that item's `rule.outcomeRule` is `undefined`.
  - The same with a move rule (`effect: "move", target: "## Errands"`): the item's `rule.moveTo` is `"## Errands"`.
  - `sourceNeedsWrite({ kind: "backlog", sourceAction: "delete" }, decided)` is `false` when all four index lists are empty, `true` when `movedLineIndices` is not.

- [ ] **Step 2: Write the failing flow tests in `rollover-flow.test.js`**

Add a `bringBack({ backlog, today = "", decisions, templateHeading = "none", skipExisting = false, removeEmpty = false, skipCompleted = false, track = false, rules = [] })` helper next to `reviewedRollover()`, built from the same calls: parse the backlog with `getSections()` (children on), `backlogSource()`, `planSources()` (with `backlogEnabled: false`, `cancelEnabled: true`), `decisions(items, defaults)` as in `reviewedRollover()`, `applySources()`, `insertSources()`, `writeSource()` (settings as in `reviewedRollover()`). It returns `{ today, backlog, items, inserted }`.

A `describe("bring back from the backlog")` with these tests (`BACKLOG` below; `pick(map)` returns a decisions function that sets the items whose label (`itemLabel()`) is in `map` and keeps the defaults otherwise):

```js
const BACKLOG = [
  "## Someday",
  "",
  "- [ ] Learn Rust [from:: [[2026-11-01]]]",
  "  - [ ] pick a book",
  "  - [x] install toolchain",
  "- [ ] Fix bike [from:: [[2026-11-02]]]",
  "- [ ] ",
  "  - [x] done under empty",
  "- [ ] Read Dune [from:: [[2026-11-03]]]",
  "",
].join("\n");
```

  - **chosen items move, the rest stay** (`skipCompleted: true`, `removeEmpty: true`, `templateHeading: "## Tasks"`, `today: "## Tasks\n\n- [ ] Standup\n"`, Learn Rust → roll, Fix bike → cancel): `backlog` is exactly `"## Someday\n\n- [-] Fix bike [from:: [[2026-11-02]]]\n- [ ] \n  - [x] done under empty\n- [ ] Read Dune [from:: [[2026-11-03]]]\n"`; today's lines contain `"- [ ] Learn Rust"` and `"  - [ ] pick a book"` after `"## Tasks"`, and no line contains `"[from::"` or `"Someday"`.
  - **without a template heading, no backlog heading is recreated** (`today: ""`, Learn Rust → roll): no line of today's note starts with `#`.
  - **everything on Stay writes nothing**: the defaults; `sourceNeedsWrite()` is false and `backlog` equals `BACKLOG`.
  - **skip existing compares without the from field** (`skipExisting: true`, `today: "- [ ] Read Dune\n"`, Read Dune → roll): today's note has `"- [ ] Read Dune"` once, the backlog has no Read Dune line, `inserted.perSource[0].todosAlreadyPresent` is 1.
  - **the same todo parked twice** (backlog `"- [ ] Read Dune [from:: [[2026-11-03]]]\n- [ ] Read Dune [from:: [[2026-11-05]]]\n"`, both → roll, `skipExisting: true`): today's note has `"- [ ] Read Dune"` exactly once, the backlog is `""` or holds no Read Dune line.
  - **a move rule wins** (backlog `"- [ ] Buy soil #errands [from:: [[2026-11-01]]]\n"`, rule `{ id: "m", enabled: true, match: "tag", value: "#errands", effect: "move", target: "## Errands" }`, → roll, `templateHeading: "## Tasks"`, `today: "## Tasks\n"`): today's lines contain `"## Errands"` followed (after an optional blank line) by `"- [ ] Buy soil #errands"`.
  - **an outcome rule does not preselect** (rule `#someday` → `roll`, backlog `"- [ ] Learn Rust #someday [from:: [[d]]]\n"`): the item's default is `"leave"`.
  - **counters are kept, not raised** (`track: true`, backlog `"- [ ] A [rolled:: 2] [from:: [[d]]]\n"`, → roll): today's note has `"- [ ] A [rolled:: 2]"`.
  - **CRLF** (backlog `"## Someday\r\n\r\n- [ ] A [from:: [[d]]]\r\n- [ ] B [from:: [[d]]]\r\n"`, A → roll): `backlog` is `"## Someday\r\n\r\n- [ ] B [from:: [[d]]]\r\n"`, and today's note contains `"- [ ] A"` and no `"[from::"`.
  - **round trip**: `reviewedRollover({ yesterday: "- [ ] Learn Rust [rolled:: 3]\n  - [ ] pick a book\n", action: "delete", track: true, decisions: () => ({ "0:0": "backlog" }) })` gives a `backlog`; `bringBack({ backlog: that, decisions: all roll })` gives today's lines `["- [ ] Learn Rust", "  - [ ] pick a book"]` (ignoring blank lines).

- [ ] **Step 3: Run them to see them fail.** `pnpm test -- src/rollover-sources.test.js src/rollover-flow.test.js`. Expected: FAIL, `backlogSource` is not exported.

- [ ] **Step 4: Implement the Interfaces above.**

- [ ] **Step 5: Run them to see them pass.** Same command, then all of `pnpm test`. Expected: PASS; no existing test changed.

- [ ] **Step 6: Commit**

```bash
git add src/rollover-items.js src/rollover-plan.js src/rollover-sources.js src/rollover-sources.test.js src/rollover-flow.test.js
git commit -m "Add the backlog as a rollover source that defaults to stay"
```

---

### Task 4: Notices for the backlog source and a bring back

**Files:**
- Modify: `src/rollover-sources.js` (`sourceLabel()`, `sourceUnchangedNotice()`, `sourceWriteFailedNotice()`, new `bringBackNotice()`)
- Test: `src/rollover-sources.test.js`

**Interfaces:**
- Produces: `bringBackNotice({ broughtBack, alreadyPresent, cancelled, name, templateHeadingNotFound, templateHeading }) → string` (lines joined with `\n`, `""` when there is nothing to say). `broughtBack` and `alreadyPresent` count lines, as the rollover's counts do.

- [ ] **Step 1: Write the failing tests** with these exact strings:

  - `sourceLabel({ kind: "backlog", name: "Backlog" })` → `"the backlog note 'Backlog'"`.
  - `sourceUnchangedNotice({ kind: "backlog", name: "Backlog" })` → `"Bring back left the backlog note 'Backlog' unchanged: it was edited while the dialog was open. Its todos were still added to today's note; remove them from the backlog yourself."`
  - `sourceWriteFailedNotice({ kind: "backlog", name: "Backlog" }, new Error("locked"))` → `"Bring back couldn't write the backlog note 'Backlog' (locked), so it was left unchanged. Its todos were still added to today's note."`
  - `bringBackNotice({ broughtBack: 2, alreadyPresent: 0, cancelled: 0, name: "Backlog" })` → `"Brought back 2 todos from Backlog."`; with `broughtBack: 1` → `"Brought back 1 todo from Backlog."`.
  - All parts: `{ broughtBack: 2, alreadyPresent: 1, cancelled: 1, name: "Backlog", templateHeadingNotFound: true, templateHeading: "## Tasks" }` → `"Rollover couldn't find '## Tasks' in today's daily note. Rolling todos to end of file.\nBrought back 2 todos from Backlog.\n- 1 was already in today's note.\n- 1 cancelled."`; `alreadyPresent: 2` → `"- 2 were already in today's note."`.
  - Nothing: all zero → `""`.
  - The existing tests for the other kinds still pass unchanged.

- [ ] **Step 2: Run them to see them fail.** `pnpm test -- src/rollover-sources.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement.** The template line is the same text `rolloverNotice()` writes.

- [ ] **Step 4: Run them to see them pass.** `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rollover-sources.js src/rollover-sources.test.js
git commit -m "Add the bring-back notices"
```

---

### Task 5: The command, the dialog's bring-back form and undo

**Files:**
- Create: `e2e/bring-back.e2e.js`
- Modify: `src/index.js` (`bringBack()`, the command in `onload()`), `src/ui/ReviewModal.js`, `src/ui/UndoModal.js`, `styles.css`, `e2e/helpers/rollover.js` (`REVIEW_ROWS_JS` reads `.rollover-from-badge` too)

**Interfaces:**
- Consumes: `parseNote()`, `writeRollover()` (Task 1); `stripFromField()`, `fromNote()`, `summarizeBringBack()` (Task 2); `backlogSource()`, `planSources()` (Task 3); `bringBackNotice()`, `BACKLOG_GUARD_NOTICE` (Task 4 and existing).
- Produces:
  - `ReviewModal` option `mode: "rollover" | "bringBack"` (default `"rollover"`). In `"bringBack"`: title `Bring back from {name}`; outcomes in the order `roll`, `leave`, `cancel` (cancel only with `cancelEnabled`), labelled `Bring back`, `Stay`, `Cancel`; shortcut buttons `All back` (→ roll) and `All stay` (→ leave); summary from `summarizeBringBack()`; each row's label is `itemLabel()` of the item with its head passed through `stripFromField()`; a `span.rollover-from-badge` with text `from {fromNote(head)}` when `fromNote()` is not null; no stale badge.
  - `.rollover-from-badge` in `styles.css` with the same declarations as `.rollover-rule-badge`.
  - The undo entry carries `kind` (`"rollover"` or `"bring-back"`). For `"bring-back"`, `UndoModal`'s description is exactly: `Undoing a bring back puts today's note and the backlog note back as they were before it. Any text you added to them since may be lost.` The rest of `UndoModal` is unchanged.

`bringBack()`, in order (spec section "The command"):
1. `getDailyNoteSettings(this.app)`; when `null`, the same notice `rollover()` shows for a command run. `isDailyNotesEnabled()`; when false, the same notice `rolloverDailyNote()` shows.
2. Today's note via `todayNotePath(settings, window.moment())`; when it is not a TFile: notice `Create today's daily note first, then bring todos back.`
3. When `rolloverInProgress`: notice `A rollover is already in progress.`; otherwise set it, and clear it in a `finally`.
4. `this.getBacklogPath()` equal to today's path: notice `BACKLOG_GUARD_NOTICE`, stop.
5. Missing backlog file: notice `There is no backlog note at '{path}' yet.` No open todos (no section with `incompleteTodos`): `The backlog note '{basename}' has no open todos.`
6. `planSources()` on `[backlogSource(…)]` with the rollover's planning settings but `backlogEnabled: false`.
7. `new ReviewModal(this.app, { sources: [{ name, sections, items }], decisions, staleSettings, backlogEnabled: false, cancelEnabled, mode: "bringBack" }).openAndWait()`; `null` → return silently.
8. No item decided `roll` or `cancel`: notice `Nothing brought back.`, return (no undo entry recorded).
9. `writeRollover({ file: today, sources, plans, decisions, backlogPath: null, templaterGuard: false, undoKind: "bring-back", buildNotice: (s) => bringBackNotice({ broughtBack: s.todosAdded, alreadyPresent: s.todosAlreadyPresent, cancelled: s.cancelledCount, name, templateHeadingNotFound: s.templateHeadingNotFound, templateHeading }) })`.

- [ ] **Step 1: Write the failing e2e tests in `e2e/bring-back.e2e.js`**, in the style of `e2e/inbox.e2e.js` (`reset()`, `runCommand()`, `waitForReview()`, `reviewRows()`, `setOutcome()`, `reviewSummary()`, `clickButton()`, `waitForNotice()`, `waitForIdle()`, `readNote()`, `afterEach(expectNoErrors)`). Fixture: `Backlog.md` = `"## Someday\n\n- [ ] Learn Rust [from:: [[2026-11-01]]]\n- [ ] Fix bike [from:: [[2026-11-02]]]\n- [ ] Read Dune [from:: [[2026-11-03]]]\n"`, notes `standardNotes({ withToday: true })` plus it, settings `{ backlogNotePath: "Backlog.md", templateHeading: "## Tasks" }` unless a test says otherwise.

  1. **only offered with a backlog note**: `app.commands.findCommand('daily-catch-up:bring-back-from-backlog').checkCallback(true)` is `false` with `backlogNotePath: ""` and `true` with it set.
  2. **brings back the chosen todos**: the dialog's title is `Bring back from Backlog`; `reviewRows()` gives labels `["Learn Rust", "Fix bike", "Read Dune"]`, every `outcome` `"leave"`, badges `["from 2026-11-01"]`, `["from 2026-11-02"]`, `["from 2026-11-03"]`; set Learn Rust and Read Dune to `roll`; `reviewSummary()` is `"2 to bring back, 1 stay"`; Apply; notice `Brought back 2 todos from Backlog.`; today's note has `- [ ] Learn Rust` and `- [ ] Read Dune` below `## Tasks` and no `[from::`; `Backlog.md` is exactly `"## Someday\n\n- [ ] Fix bike [from:: [[2026-11-02]]]\n"`.
  3. **cancel marks in the backlog**: Fix bike → `cancel`; Apply; notice contains `- 1 cancelled.`; `Backlog.md` contains `- [-] Fix bike [from:: [[2026-11-02]]]`.
  4. **nothing chosen changes nothing**: Apply at once; notice `Nothing brought back.`; `snapshotNotes()` of today's note and `Backlog.md` equal before and after.
  5. **closing the dialog changes nothing**: `pressEscape()`; `waitForIdle()`; both notes unchanged; no notice containing `Brought back`.
  6. **undo**: bring back Learn Rust; run `undo-rollover`; the dialog text contains `Undoing a bring back`; Confirm Undo; both notes equal their state before the bring back.
  7. **no today's note**: `standardNotes()` without `withToday`; notice `Create today's daily note first, then bring todos back.`; today's note still does not exist.
  8. **missing and empty backlog**: without `Backlog.md`, notice `There is no backlog note at 'Backlog.md' yet.`; with `"## Someday\n"`, notice `The backlog note 'Backlog' has no open todos.`
  9. **a backlog edited during the dialog is left alone**: as the inbox test "a capture during the review leaves the inbox alone": append `- [ ] New idea\n` to `Backlog.md` with `vault.process` while the dialog is open, set Learn Rust to `roll`, Apply; notice is Task 4's backlog `sourceUnchangedNotice` text; today's note has Learn Rust; `Backlog.md` still has all three todos and New idea.
  10. **round trip**: `standardNotes({ withToday: true })` with `onRolloverSourceAction: "delete"`; run `review-and-rollover`, set `Write report` (as the review labels it; check `e2e/fixtures/notes/previous.md`) to `backlog`, Apply, wait for idle; run `bring-back-from-backlog`, set it to `roll`, Apply; today's note has a line starting `- [ ] Write report` with no `[from::`, and the backlog has no Write report line.
  11. **phone width**: as `e2e/layout.e2e.js` does for the review dialog, open the bring-back dialog at phone width; `horizontalOverflow('.modal')` is 0; take a `screenshot("bring-back-phone")`.

- [ ] **Step 2: Run them to see them fail.** `pnpm test:e2e e2e/bring-back.e2e.js`. Expected: FAIL (no such command).

- [ ] **Step 3: Implement `bringBack()`, the command, the `ReviewModal` mode, the `UndoModal` description, the CSS and the helper's badge selector.**

- [ ] **Step 4: Run the new file, then everything.** `pnpm test:e2e e2e/bring-back.e2e.js` three times (test 9 races an edit against the dialog on purpose); every run must pass. Then `pnpm test`, `pnpm build` and the full `pnpm test:e2e`. Expected: all pass. Look at `e2e/screenshots/bring-back-phone.png`.

- [ ] **Step 5: Commit**

```bash
git add src/index.js src/ui/ReviewModal.js src/ui/UndoModal.js styles.css e2e/helpers/rollover.js e2e/bring-back.e2e.js
git commit -m "Add the Bring back from backlog command"
```

---

### Task 6: Docs, and closing the branch

**Files:**
- Modify: `README.md`, `src/settings-text.js`, `CLAUDE.md`, `docs/roadmap.md`
- Delete (last commit of the branch): `docs/design/plans/2026-11-23-backlog-bring-back.md`

- [ ] **Step 1: README.** A "Bringing todos back" paragraph after the backlog example in Usage (around the "Todos sent to the backlog…" paragraph): the command name, that every todo starts on Stay, Bring back / Stay / Cancel, that returning todos land where rolled todos land without the backlog's headings and without `[from:: …]`, that the backlog keeps its headings and everything not chosen, and that "Undo last rollover" undoes it. Then the known limitation from the spec: a brought-back todo keeps its tags, so a rule that sends a tag such as `#someday` to the backlog sends it back on the next rollover; remove the tag (from the todo in today's note) when bringing such a todo back. In the Undo section, one sentence that it also undoes a bring back, restoring today's note and the backlog note (Templater does not stop today's note being restored here).

- [ ] **Step 2: Settings help.** In `SETTING_GROUPS`' "Review and backlog" help, after the sentence about the Backlog choice: `Run **Bring back from backlog…** to pick todos from the backlog note and move them back into today's note.` Run `pnpm test -- src/settings-text.test.js`. Expected: PASS.

- [ ] **Step 3: CLAUDE.md.** In Architecture: `src/index.js` (the bring-back command, `bringBack()`, `parseNote()`, `writeRollover()` and its `templaterGuard`), `src/rolled-count.js` (`stripFromField()`, `fromNote()`), `src/rollover-items.js` (`summarizeBringBack()`), `src/rollover-plan.js` (`applyPlan()`'s `deleteOnlyChosen`), `src/rollover-sources.js` (`backlogSource()`, `kind: "backlog"` in `planSources()`, `applySources()`, `sourceNeedsWrite()`, `sourceLabel()`, `bringBackNotice()`), `src/ui/ReviewModal.js` (`mode: "bringBack"`), `src/ui/UndoModal.js` (the entry's `kind`). Rollover flow: a short paragraph on the bring-back flow. Testing: `e2e/bring-back.e2e.js` in the list of e2e files.

- [ ] **Step 4: Roadmap.** Tick "Pull from the backlog note as a source" and point item 5 of "Sizing and order" at the design: `Design: [2026-11-23-backlog-bring-back-design.md](design/2026-11-23-backlog-bring-back-design.md).` Add a "Follow-ups" note: a filter field for long backlogs; offering the backlog inside "Review and roll over todos…".

- [ ] **Step 5: Verify and commit.** `pnpm test`, `pnpm build`. Expected: PASS.

```bash
git add README.md src/settings-text.js CLAUDE.md docs/roadmap.md
git commit -m "Document Bring back from backlog"
```

- [ ] **Step 6: Offer the review clip.** Tell the user a private clip of the bring-back dialog can be recorded (`e2e/demos/private/bring-back.demo.js`, `pnpm demo bring-back`), and record it if they want it. Never commit it.

- [ ] **Step 7: After the final review is done**, delete this plan as the branch's last commit:

```bash
git rm docs/design/plans/2026-11-23-backlog-bring-back.md
git commit -m "Remove the bring-back plan now the feature is done"
```
