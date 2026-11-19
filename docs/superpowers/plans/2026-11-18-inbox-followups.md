# Inbox Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Undo keeps lines that arrived in the inbox after the rollover; the inbox and backlog settings follow vault renames; the "Move nested items when marking" docs cover the inbox.

**Architecture:** Two pure helpers with unit tests, each wired by a few lines in `src/index.js` / `src/ui/UndoModal.js`: a three-way line merge for the inbox's undo, and a rename mapping for note path settings.

**Tech Stack:** Plain JavaScript ES modules, Obsidian API, rollup, vitest, the e2e suite in `e2e/`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-inbox-source-design.md`, section "Follow-ups (2026-11-18)".

## Global Constraints

- With no inbox and no backlog note set, nothing changes. The `defaults` and `checklist` e2e baselines pass untouched; never regenerate `e2e/fixtures/expected/`.
- Undo for today's note, the previous note and the backlog note stays a plain snapshot restore. Only the inbox's undo keeps new lines. When the inbox gained no lines since the rollover, its undo is exactly the snapshot restore it is today.
- A renamed setting is stored as the note's full vault path with `.md` (what `getNotePath()` returns), and saved with `saveSettings()`.
- New logic in pure modules with unit tests; `index.js` and `src/ui/` stay thin.
- Commit messages: plain imperative subject, no `Co-Authored-By` or `Claude-Session` lines. Prettier only on files a task creates.
- e2e run-count rule (CLAUDE.md): a new or changed timing-dependent e2e test's file runs twice, every run passing; then the full suite once.

## Review Focus

1. **A capture that lands right where the rollover deleted todos** (QuickAdd "Insert after" the same heading): after undo the restored todos and the capture are both there, restored ones first. Test in Task 1.
2. **Undo after Mark** (the rollover changed `- [ ] a` to `- [>] a` rather than removing it) with a capture added: the restored line is `- [ ] a` and the capture is kept once. Test in Task 1.
3. **A line edited in the inbox during the window**: the restored original and the edited text both come back, side by side; nothing is lost. Test in Task 1.
4. **A folder renamed that contains the inbox and the backlog note**: both settings update. Test in Task 2.
5. **A rename of an unrelated note or folder whose path only shares a prefix** (`Notes2/` vs `Notes/`): nothing changes. Test in Task 2.

---

## Setup

- [ ] Work on branch `feat/inbox-source` (the inbox branch, not yet merged).

---

### Task 1: Undo keeps lines added to the inbox since the rollover

**Files:**
- Create: `src/undo-merge.js`, `src/undo-merge.test.js`
- Modify: `src/index.js` (the inbox's undo entry), `src/ui/UndoModal.js` (restore and the dialog line), `e2e/inbox.e2e.js`, `README.md`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `restoreKeepingNewLines({ before, after, current }) → string`: `before` is the note before the rollover, `after` as the rollover left it, `current` as it is at undo time. Returns `before` when `current === after`. Otherwise `before` with every run of lines that `current` has and `after` does not (an insertion in a line diff of `after` → `current`) inserted into `before`: placed just before the `before` line matched (in a line diff of `before` → `after`) to the first `after` line after the insertion point that has such a match (so lines the rollover removed at that spot come first), or at the end of `before` (before its trailing empty line, when it ends with a newline) when no matched line follows. Lines `current` dropped relative to `after` are not carried over; a line `current` changed counts as new (a diff cannot tell an edit from a removal plus an insertion), so its edited text is kept next to the restored original. Split and join on `"\n"` (so `\r` stays part of a line).
  - `addedLineCount({ after, current }) → number`: how many lines `restoreKeepingNewLines()` would keep.
  - Undo entry for the inbox source: `{ file, oldContent, newContent, keepNewLines: true }` (`newContent`: the inbox as the rollover wrote it). Other sources keep `{ file, oldContent }`.
  - `UndoModal`: restores an entry with `keepNewLines` through `vault.process(file, (current) => restoreKeepingNewLines({ before: oldContent, after: newContent, current }))`; its dialog line, when `addedLineCount() > 0`, is `- {file name}: will be restored, keeping {n} line(s) added since the rollover.` (`line` when `n` is 1, else `lines`); otherwise the existing `parseDay()` line.

- [ ] **Step 1: Write the failing unit tests** in `src/undo-merge.test.js`:
  - `"nothing added: the snapshot"`: `current === after` → `before`.
  - `"a capture after the deleted todos"`: before `"## Captured\n- [ ] a\n- [ ] b\n"`, after `"## Captured\n"`, current `"## Captured\n- [ ] c\n"` → `"## Captured\n- [ ] a\n- [ ] b\n- [ ] c\n"`.
  - `"a capture at the end of a longer note"`: before `"## Captured\n- [ ] a\n\n## Later\n- [ ] x\n"`, after `"## Captured\n\n## Later\n- [ ] x\n"`, current `"## Captured\n\n## Later\n- [ ] x\n- [ ] c\n"` → `"## Captured\n- [ ] a\n\n## Later\n- [ ] x\n- [ ] c\n"`.
  - `"undo after mark"`: before `"- [ ] a\n"`, after `"- [>] a\n"`, current `"- [>] a\n- [ ] c\n"` → `"- [ ] a\n- [ ] c\n"`.
  - `"a capture into an emptied note"`: before `"- [ ] a\n"`, after `""`, current `"- [ ] c\n"` → `"- [ ] a\n- [ ] c\n"`.
  - `"an edited line comes back next to the original"`: before `"## C\n- [ ] a\n- [ ] keep\n"`, after `"## C\n- [ ] keep\n"`, current `"## C\n- [ ] keep (edited)\n- [ ] c\n"` → `"## C\n- [ ] a\n- [ ] keep\n- [ ] keep (edited)\n- [ ] c\n"`.
  - `"two separate runs"`: before `"## A\n- [ ] a\n## B\n- [ ] b\n"`, after `"## A\n## B\n"`, current `"## A\n- [ ] x\n## B\n- [ ] y\n"` → `"## A\n- [ ] a\n- [ ] x\n## B\n- [ ] b\n- [ ] y\n"`.
  - `"no newline at the end"`: before `"- [ ] a"`, after `""`, current `"- [ ] c"` → `"- [ ] a\n- [ ] c"`.
  - `addedLineCount`: 0 for the first case, 1 for the second, 2 for the edited-line case and for the two-runs case.
- [ ] **Step 2: Run them to see them fail.** `pnpm test -- src/undo-merge.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement** with a line-level LCS diff (notes are small; quadratic is fine). Header comment saying what the module is for.
- [ ] **Step 4: Run them.** PASS.
- [ ] **Step 5: Wire it.** `index.js`: the inbox source's undo entry gets `newContent` (the content the write produced) and `keepNewLines: true`. `UndoModal`: restore and dialog line as above.
- [ ] **Step 6: e2e** in `e2e/inbox.e2e.js`: `"undo keeps a capture that arrived after the rollover"`: roll over (inbox Delete), append `- [ ] Pick up parcel` to `Inbox.md` through `app.vault.process` (`startAsync()` / `awaitAsync()`), run undo and confirm: `Inbox.md` is the original content with `- [ ] Pick up parcel` after `- [ ] Call Sam`; today's note is restored. Run `e2e/inbox.e2e.js` twice (both pass), then the full suite once.
- [ ] **Step 7: Docs.** README (Inbox section: undo keeps captures that arrived since the rollover). `CLAUDE.md`: `src/undo-merge.js` in the core files, the inbox's undo entry shape, `e2e/inbox.e2e.js` line.
- [ ] **Step 8: Build, test, commit.** `pnpm build && pnpm test`; `git commit -m "Keep inbox lines added since the rollover when undoing"` (with the files above).

---

### Task 2: The inbox and backlog settings follow renames; Move-nested docs

**Files:**
- Create: `src/note-paths.js`, `src/note-paths.test.js`
- Modify: `src/index.js` (a vault `rename` handler), `e2e/inbox.e2e.js` (or a new `e2e/renames.e2e.js`), `README.md`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `followRename(notePath, oldPath, newPath) → string | null`: `notePath` is the setting's vault path (`getNotePath()`), `oldPath` / `newPath` the renamed file's or folder's paths. Returns `newPath` when `notePath === oldPath`, `newPath + notePath.slice(oldPath.length)` when `notePath` starts with `oldPath + "/"`, else `null`. `null` for a null `notePath`.
  - In `onload()`, `this.registerEvent(this.app.vault.on("rename", (file, oldPath) => …))`: for `inboxNotePath` (when set) and `backlogNotePath` (when set), `followRename(<its getNotePath()>, oldPath, file.path)`; any non-null result is stored in that setting, then `saveSettings()` once.

- [ ] **Step 1: Write the failing unit tests** in `src/note-paths.test.js`:
  - the note itself renamed: `followRename("Notes/Inbox.md", "Notes/Inbox.md", "Notes/Capture.md")` → `"Notes/Capture.md"`;
  - its folder renamed: `followRename("Notes/Inbox.md", "Notes", "Capture")` → `"Capture/Inbox.md"`; a parent folder: `followRename("A/B/Inbox.md", "A", "Z")` → `"Z/B/Inbox.md"`;
  - unrelated: `followRename("Notes/Inbox.md", "Other.md", "Else.md")` → `null`; prefix only: `followRename("Notes2/Inbox.md", "Notes", "Capture")` → `null`; `followRename(null, "a", "b")` → `null`.
- [ ] **Step 2: Run them to see them fail.** `pnpm test -- src/note-paths.test.js` → FAIL.
- [ ] **Step 3: Implement `followRename`.**
- [ ] **Step 4: Run them.** PASS.
- [ ] **Step 5: Wire the rename handler** in `onload()`.
- [ ] **Step 6: e2e**: `"the inbox and backlog settings follow a folder rename"`: settings `inboxNotePath: "Notes/Inbox.md"`, `backlogNotePath: "Notes/Backlog.md"`, both notes present; rename the folder `Notes` → `Capture` through `app.fileManager.renameFile()`; `waitFor()` the plugin's settings to read `Capture/Inbox.md` and `Capture/Backlog.md`, and `data.json` to hold them (read it through the plugin's `loadData()` or the vault adapter); then a rollover drains `Capture/Inbox.md`. `"a renamed inbox note is followed"`: rename `Inbox.md` → `Captured.md`; the setting follows. Run the file twice (both pass), then the full suite once.
- [ ] **Step 7: Docs.** README: the Inbox and Backlog settings follow renames of the note or its folder. README and `CLAUDE.md`: "Move nested items when marking" applies to every note set to Mark — the previous day's note and the inbox (update its README section, which says it applies only when **After rollover** is set to mark, and the `moveNestedItemsOnMark` entry in `CLAUDE.md`'s settings list). `CLAUDE.md`: `src/note-paths.js` in the core files, the rename handler in the `index.js` entry.
- [ ] **Step 8: Build, test, commit.** `pnpm build && pnpm test`; `git commit -m "Follow renames of the inbox and backlog notes"` (with the files above).
