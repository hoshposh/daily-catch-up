# End-to-end tests in Obsidian

Design for an automated end-to-end suite that runs the plugin inside the real Obsidian app, through the official Obsidian CLI. Brainstormed on 2026-11-15. Decisions made in that conversation are marked as such; everything else is a call made from the code and the CLI, listed under [Calls to check](#calls-to-check).

## Intent

Every feature branch so far ended with manual checks in a test vault: `.claude/manual-test-checklist.md` (eight checks for review and aging) and the "Manual check in the test vault" steps in each plan (for example Tasks 5 and 6 of `docs/superpowers/plans/2026-11-12-rules.md`). Each check means resetting the vault with `/setup-test-fixture`, hand-editing settings, opening today's note, clicking through a dialog, and asking Claude to compare the vault files. Each check is done once, on its branch, and never again.

The goal (decided) is fewer manual tests and more automated ones. A committed suite that reruns every past check on every branch was chosen over having Claude drive each branch's checklist through the CLI (decided), because only the suite reduces manual work over time and catches a later change breaking an earlier feature.

Success looks like:

- `pnpm test:e2e` reruns everything the review-and-aging checklist checked by hand and passes on `main`; once merged into `feat/rules`, it also covers the rules plan's manual steps and replaces them there.
- A new feature's plan has an e2e test where it used to have a manual check step.
- What remains manual is only judging screenshots (layout, theme), and the suite produces those screenshots.

## Goals

1. A vitest suite, `pnpm test:e2e`, that drives the running Obsidian app through the `obsidian` CLI against a dedicated vault named `e2e-vault` (decided: option 1 below; the vault exists and is open in Obsidian).
2. The suite prepares the vault itself on every run, idempotently, so the only manual step ever is opening the vault in Obsidian once.
3. First coverage: every check in `.claude/manual-test-checklist.md` (including the optional Remove empty todos step that was never run) and the manual steps of the rules plan (decided).
4. Judgement checks (phone width, dark theme) assert what is measurable (no horizontal overflow) and save screenshots for a person to look at; screenshots never fail a test (decided).
5. A process change (decided): CLAUDE.md tells future plans to write an e2e test instead of a "Manual check in the test vault" step, keeping a manual step only for what a screenshot cannot settle.

## Branching (decided)

The suite is built on its own branch, `feat/e2e-tests`, in a worktree created from `main`, not on `feat/rules` (where this was first discussed). It is merged into `main`, and `main` is then merged into `feat/rules`, where the rules tests (checks 9 and 10 below) are written and replace that branch's remaining manual checks. Consequences:

- On `feat/e2e-tests` the plugin has no rules, so checks 9 and 10 cannot run there. They are a second part of the work, done on `feat/rules` after the merge.
- `feat/e2e-tests` changes nothing in `src/`, so its build is `main`'s build. Check 1's expected files are generated on it; after the merge, the same test on `feat/rules` shows that rules, all switched off, change nothing.

## Non-goals (decided)

- Running in CI or headless.
- Testing against several Obsidian versions.
- Interop with Templater, Obsidian Tasks or Journals (needs those plugins installed in the e2e vault; later).

## Anti-goals

- Touching any vault other than `e2e-vault`. In particular the manual `test-vault` and its settings must never change because the suite ran.
- Slowing down or complicating `pnpm test`. The unit suite stays fast and needs no Obsidian.
- Flaky tests. A test that sometimes fails will be ignored, which is worse than no test. Waiting is done by polling for a condition, never by fixed sleeps that happen to be long enough.
- Moving logic into the test helpers that belongs in the plugin, or adding test-only hooks to `src/` that change behaviour.

## Approaches

1. **Vitest e2e suite driving the running Obsidian through the CLI** (chosen). Same runner as the unit tests, no new dependencies, works today. Only runs on a machine with Obsidian open, and takes over the e2e vault's window while it runs.
2. **WebdriverIO with `wdio-obsidian-service`**, which downloads and launches its own Obsidian against a sandboxed vault. Runs headless in CI and across Obsidian versions, but brings a second test framework (WebdriverIO + mocha), a large download, slower runs and more setup. Worth revisiting if CI becomes a goal; tests written for option 1 should port, since the helpers isolate how Obsidian is driven.
3. **Claude runs each branch's checklist through the CLI**, nothing committed. Cheapest to start, but each check still runs once and the result depends on Claude repeating steps faithfully. Rejected because it doesn't reduce manual work over time.

A plain Node or shell script runner was dropped: it would rebuild assertions and reporting that vitest already has.

## What exists today

### The Obsidian CLI

Obsidian 1.15.0 (installer 1.12.4) is installed with the CLI enabled (`"cli": true` in `~/.config/obsidian/obsidian.json`). `obsidian vault=<name> <command> key=value …` talks to the running app. Commands the suite needs:

| Command                                                            | Use                                                                                                             |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `vault info=path`                                                  | Resolve `e2e-vault`'s path, so no path is hardcoded                                                             |
| `eval code=<js>`                                                   | Run JS in the app (`app` is global); prints `=> <result>`                                                       |
| `command id=<id>`                                                  | Run a command (`daily-catch-up:rollover`, `daily-catch-up:review-and-rollover`, `daily-catch-up:undo-rollover`) |
| `daily`                                                            | Open today's daily note, creating it from the template (the user's real path)                                   |
| `plugin:reload id=…`, `plugin:enable id=…`, `plugins:restrict off` | Load the fresh build                                                                                            |
| `dev:dom selector=… [text] [all] [total]`                          | Read the review dialog, notices, settings tab                                                                   |
| `dev:errors`, `dev:console level=error` (with `clear`)             | Fail on errors the plugin logged                                                                                |
| `dev:screenshot path=…`, `dev:mobile on/off`                       | Screenshots and phone-width emulation                                                                           |

Verified behaviour that shapes the helpers:

- `eval` returns an already-resolved promise's value (`Promise.resolve(42)` → `=> 42`), but printed nothing for a promise that resolved after 300 ms. So async work is started by one `eval` and its result polled for with later `eval`s (for example stored on `window.__e2e`).
- `eval` of code that throws prints `Error: boom` and **exits 0**. The helper must treat output starting with `Error:` as a failure.
- `commands filter=daily-catch-up` lists only the two rollover commands; the undo command uses `checkCallback` and only appears when undo is available. `app.commands.commands['daily-catch-up:undo-rollover']` exists regardless.
- The CLI only reaches vaults Obsidian already knows. `e2e-vault` (`/home/lyndonw/data/obsidian-stuff/e2e-vault`) is registered and open. It is fresh: core Daily notes and Templates on, no `daily-notes.json`, no community plugins, restricted mode presumably on.

### The plugin

- `src/index.js`: `rollover(file, { review, isAutomaticRun })` runs on vault `create` (when `rolloverOnFileCreate`) for today's daily note created within 5 s (`MAX_TIME_SINCE_CREATION`), or from the commands (which ignore the creation window). `getLastDailyNote()` returns the second newest daily note dated on or before today, so today's note must exist for a rollover.
- Settings: `plugin.settings`, saved with `saveSettings()` to `data.json`; `loadSettings()` migrates and seeds `rules` with `EXAMPLE_RULES` when the stored settings have no `rules` key.
- Review dialog (`src/ui/ReviewModal.js`): content has class `rollover-review`; badges `rollover-stale-badge` and `rollover-rule-badge`; one dropdown per item; "All roll" / "All leave" buttons; summary `rollover-review-summary`; Apply and Cancel buttons. Escape or Cancel abandons the rollover.
- Undo dialog (`src/ui/UndoModal.js`): lists the notes it will restore; "Confirm Undo" button.
- Notices (`new Notice(…)`) are DOM elements that disappear after a few seconds.
- Undo history lasts 2 minutes.

### Constraint: the repo folder is the manual vault's plugin folder

`test-vault/.obsidian/plugins/daily-catch-up` is a symlink to this repo, so `main.js` and `data.json` (both gitignored) in the repo root belong to the manual vault. The e2e vault must **not** use a symlink: its settings writes would overwrite the manual vault's `data.json`. Its plugin folder is a real folder, and the suite copies `main.js`, `manifest.json` and `styles.css` into it after building (the copy method in CONTRIBUTING.md).

### Existing fixtures

`test-vault/templates/yesterday-fixture.md` (41 lines: Project / Home, Review, Aging sections) and `templates/daily-test.md` (today's template, `## Tasks` with Project / Home todos already present for the skip-existing case) are what the checklist was run against. Copy both into the repo as the starting fixtures.

## Design

### Layout

```txt
e2e/
  helpers/obsidian.js   # CLI wrapper: run, evalJs, command, dom, waitFor, errors
  helpers/vault.js      # bootstrap, reset, write fixture notes, read notes
  fixtures/             # note fixtures and expected outputs
  *.e2e.js              # test files
vitest.e2e.config.js
```

`package.json` gains `"test:e2e": "vitest run --config vitest.e2e.config.js"`. The unit run must not pick up e2e files: either name them so the default `**/*.test.js` include misses them (as above), or add a unit config that excludes `e2e/`. There is no vitest config today.

The e2e config runs files one at a time and tests in order (`fileParallelism: false`), since they share one app window. Timeouts are generous (tens of seconds per test) because the UI is real.

### Helpers

`obsidian.js` wraps `child_process.execFile('obsidian', ['vault=e2e-vault', …])`. Arguments go through `execFile` as an array, never a shell string. It:

- strips the `=> ` prefix from `eval` output and parses JSON when the code returns `JSON.stringify(…)`
- throws when output starts with `Error:` or the process fails, including the command and output in the message
- offers `waitFor(fn, { timeout, interval })`: polls an `eval` or a file read until a condition holds, and fails with the last value seen
- offers `startAsync(code)` / `awaitAsync()`: runs an async snippet that stores its result or error on `window.__e2e`, then polls for it

`vault.js`:

- **Safety guard.** Before writing anything, resolve the vault path via `vault info=path` and check that the name is `e2e-vault` (overridable with `E2E_VAULT`) and that it holds a marker file `.e2e-vault`. On the first run, the marker is created only if the vault holds nothing but `.obsidian/` and `Welcome.md`. Otherwise the suite refuses to run with a message saying why. It never writes outside that path.
- **Bootstrap** (each run, before all tests): build straight into the e2e vault with `rollup -c --environment BUILD:production --file <vault>/.obsidian/plugins/daily-catch-up/main.js`, never the repo-root `main.js` (that file is the manual `test-vault`'s plugin through its symlink, so `pnpm build` would swap the manual vault's code); copy `manifest.json` and `styles.css` alongside; set the Daily notes options (folder `daily`, format `YYYY-MM-DD`, template `templates/daily.md`); turn restricted mode off; enable and reload the plugin; turn mobile emulation off; clear captured errors.
- **Reset** (before each test): delete `daily/`, `templates/`, `Backlog/` and other test-created notes (plain deletes; the vault is disposable, so no `.trash/`); write the test's fixtures; write the test's settings; reload the plugin so it reads them, matching a fresh start; close any open modal.
- **Settings** are written as a complete object per test: the plugin defaults merged with the test's overrides. Each test then starts from known settings, with nothing leaking from the previous test. Tests that exercise `loadSettings()` itself (rules seeding) write `data.json` directly and reload.
- **Dates.** Fixture notes are named relative to the real date (the previous note is today − 1 unless a test says otherwise), and expected `[from:: [[YYYY-MM-DD]]]` links are built from the same date. Fixture content keeps literal dates (for example `📅 2026-11-10`) since those are text the plugin moves, not dates it reads.

### Driving a rollover

- **Automatic run:** create today's note the way a user does (`obsidian daily`, which creates it from the template and fires vault `create`), then wait for the result.
- **Command run:** with today's note present, `command id=daily-catch-up:rollover` or `…:review-and-rollover`.
- **Waiting for the end:** poll until `plugin.rolloverInProgress` is false and the expected files have settled (or the review dialog is open, for tests that act on it).
- **Review dialog:** find rows by their label text inside `.rollover-review`; set a row's dropdown by setting the `<select>` value and dispatching `change`; click buttons by their text; press Escape via a dispatched keydown or `modal.close()`; read badges and the summary with `dev:dom`.
- **Notices:** read `.notice` text soon after the action. Because notices expire, the helper may instead record notices as they appear (a `MutationObserver` on the notice container, installed by `eval` during bootstrap) and let tests assert on the recorded list. Either way the test does not depend on a notice still being visible.
- **Errors:** every test ends by asserting `dev:errors` captured nothing, and clears the buffer.

### Assertions

Assert on whole files where the checklist did (for example check 1, "byte-identical to main's output"): expected outputs live in `e2e/fixtures/expected/` or as vitest file snapshots. **A person must review each expected output the first time it is written**; a snapshot generated from the current code and accepted unread proves nothing. Elsewhere, assert on specific lines (as the checklist's "Pass if" items do) so tests don't break on unrelated fixture changes.

### First coverage

Each item in the checklist becomes one or more tests with the same setup and pass criteria:

1. Behaves as before: with every feature added since `main` left off, today's and the previous note match expected files. Two settings profiles, each a test: the plugin's `DEFAULT_SETTINGS`, and the checklist's profile (mark with `>`, move nested items on, skip existing on, ignore blockquotes on, children on, template heading `## Tasks`). The original reference output was for a smaller fixture and no longer exists, so the expected files are generated once on `feat/e2e-tests` (whose `src/` is `main`'s) against the same fixtures in `e2e-vault`. They are then **reviewed by the user before they are committed**, and from then on they are the regression baseline.
2. All four outcomes (Roll, Backlog, Cancel, Leave) with Delete and a backlog note in a folder that doesn't exist yet.
3. Escape cancels: automatic run shows the "Rollover skipped" notice and changes nothing; command run shows no notice and changes nothing.
4. Stale todo and counter placement (`[rolled:: n]` before `📅`, before `^block-id`, not on children; Plan trip is one row), plus the optional variant with Remove empty todos on.
5. Undo after check 2's choices: the dialog's line counts and backlog line, notes restored exactly, backlog note deleted. The test repeats check 2's steps itself, because the reload before each test clears the undo history.
6. Backlog path set to today's note: the notice, and nothing changes.
7. Review dialog at phone width (`dev:mobile on`): no horizontal overflow in the modal (`scrollWidth <= clientWidth`); screenshots in light and dark theme (switched via `app.changeTheme`) saved for review.
8. A second rollover while the dialog is open: "A rollover is already in progress." notice; Apply then rolls each todo once. Run the second command from `eval` (`app.commands.executeCommandById`), so no second window is needed.

From the rules plan (written on `feat/rules` after the merge; see [Branching](#branching-decided)):

9. Rules in the rollover: with the `#someday` and `Top 3 today` examples on, the someday todo defaults to Backlog with a "Tag #someday" badge, Top 3 todos show "→ ## Inbox", Apply puts them under `## Inbox`. Deleting the `rules` key from `data.json` and reloading brings back the examples, all off. The main fixture has no `#someday` todo or `Top 3 today` heading, so this test has its own fixture (adding them to the main one would change checks 1 and 5).
10. Rules settings group: open the settings tab on the plugin; the nine examples show switched off; toggling, reordering and deleting change only that group, and the settings scroll position doesn't change; a regex rule `(` shows the invalid-pattern error with Save disabled; clearing the Backlog note shows the note under the `#someday` rows; no horizontal overflow at phone width, with a screenshot.

### Screenshots

Saved to `e2e/screenshots/` (gitignored), named by test. The run prints their paths at the end so they can be looked at.

### Docs and process

- CLAUDE.md: a **Commands** line for `pnpm test:e2e`, the e2e files in **Architecture**, and the **Testing** paragraph changed to say that `index.js` and `src/ui/` are covered by the e2e suite. Add a rule: plans write an e2e test where they would have written a manual test-vault check, and keep a manual step only for judging screenshots.
- CONTRIBUTING.md, "Testing in Obsidian": how to run the suite (open an empty vault named `e2e-vault` once, keep Obsidian open, run `pnpm test:e2e`, don't use that window while it runs). Manual testing in a throwaway vault stays documented for exploring.
- `.claude/manual-test-checklist.md` is superseded once its checks are tests. It is a local file, excluded from git (`.git/info/exclude`), so no commit removes it; the user deletes it once `feat/rules` is finished.
- `/setup-test-fixture` stays, for manual exploration in `test-vault`.

## Calls to check

- The safety marker file and the "only an empty vault gets the marker" rule.
- The e2e vault gets its own build, not a symlink, because of the shared `data.json`; the suite builds straight into it so the repo-root `main.js` (the manual vault's plugin) is never touched.
- Check 1 covers two profiles (plugin defaults and the checklist's), with expected files generated on `feat/e2e-tests` (`main`'s code) and reviewed by the user before commit.
- Settings are written whole per test and the plugin is reloaded before each test.
- Notices are recorded by an observer rather than read once they're on screen, if reading directly proves racy.
- Test file naming (`*.e2e.js`) to keep them out of `pnpm test`.

## Left to the builder

- How exactly to set the Daily notes options (writing `daily-notes.json` and reloading the core plugin, or setting them through `app.internalPlugins` in `eval`); whichever Obsidian picks up reliably.
- Whether `obsidian daily` reliably fires the plugin's `create` handler within the 5-second window; if not, create today's note with `app.vault.create()` from the template contents.
- Selectors and how to find dialog rows; how to switch the theme back after the dark screenshot.
- Expected-output storage format (files vs vitest file snapshots).
- Timeouts and polling intervals.
