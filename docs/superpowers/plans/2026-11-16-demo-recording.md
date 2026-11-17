# Demo Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm demo <name>` records a scripted run of the plugin in `e2e-vault` as a GIF, used for a new README `demo.gif` and for private review clips.

**Architecture:** A demo is a vitest file under `e2e/demos/` that drives Obsidian with the e2e helpers. An in-app recorder captures the target window with Electron's `capturePage()` about 10 times a second and writes PNG frames. Node then merges repeated frames, gives each one its on-screen time, and builds the GIF with ffmpeg and gifsicle. A fake pointer injected into the page shows what is clicked.

**Tech Stack:** vitest 3, the `obsidian` CLI (`eval`), `@electron/remote` inside the app, ffmpeg, gifsicle 1.96.

**Spec:** `docs/superpowers/specs/2026-11-16-demo-recording-design.md`

## Global Constraints

- Branch `feat/demo-recording` in a worktree from `main` (use superpowers:using-git-worktrees). The first commit adds the spec and this plan.
- Only `e2e-vault` is touched, through `guardVault()` / `reset()`. Never the repo-root `main.js` or `data.json` (the e2e `globalSetup` guards both).
- Windows are resolved only from the e2e vault's own documents, never picked from `BrowserWindow.getAllWindows()` by position or focus. The recorder checks the window before recording or resizing and refuses otherwise.
- Gitignored: `e2e/demos/private/` and `e2e/demos/out/`. Private clips and raw frames are never committed.
- `pnpm test` must not pick up `*.demo.js`, and `pnpm test:e2e` must not pick up `e2e/demos/`.
- Waiting for the app uses `waitFor()`. `pause(ms)` is the only fixed wait, and only for viewer pacing inside demos.
- After every demo, even a failed one, the recorder is stopped, the pointer and injected CSS are removed, and the window size and side panels are restored.
- Public GIF: at most 2 MB (2 097 152 bytes), legible at GitHub's README width (about 830 px), light theme, side panels collapsed.
- `demo.gif` keeps its path in the repo root. It is replaced only after the user has watched `e2e/demos/out/readme.gif`.
- gifsicle is optional at run time: missing means a printed warning, not a failure.
- No new npm dependencies.
- No `Co-Authored-By: Claude` or `Claude-Session:` lines in commits (user's global instructions).

## Review Focus

- **The window is behind other windows or on another desktop while recording.** The user expects a correct clip anyway, or a clear message before recording starts. Pinned by Task 3's "captures a change made while recording" test, run while the user works in other windows; it also sets `setBackgroundThrottling(false)` during recording.
- **A demo fails halfway.** The user expects Obsidian to be left as before: no recorder still writing frames, no pointer, normal window size. Pinned by Task 5's `cleanupDemo()` test and by the recorder's `maxMs` auto-stop test in Task 3.
- **The user's own vaults are open in the same app.** The user expects them never to be recorded or resized. Pinned by Task 3's "refuses to record settings when the settings window is closed" test and the title-token check.
- **A frame path containing a quote or a space** (the worktree path or a demo name). The user expects the GIF to build. Pinned by Task 1's `concatList` escaping test.
- **Running a demo twice.** The user expects the second run's GIF to contain only the second run. Pinned by Task 3's "starts from an empty frames folder" test.

---

### Task 1: Frame timing and the ffmpeg input list

**Files:**

- Create: `e2e/helpers/frames.js`
- Test: `e2e/helpers/frames.test.js` (run by `pnpm test`)

**Interfaces:**

- Produces:

  - `mergeRepeats(frames: {file: string, t: number, key: string}[]): {file, t, key}[]`: drops each frame whose `key` equals the previous kept frame's `key`.
  - `withDurations(frames: {file, t}[], endT: number): {file, duration}[]`: `duration` in seconds is the next frame's `t` minus this one's (times are ms), and the last frame's is `endT - t`. Every duration is at least `0.02` (GIF delays are whole hundredths, and many viewers ignore shorter ones).
  - `concatList(frames: {file, duration}[]): string`: ffmpeg concat-demuxer text.
  - `sizeProblem(bytes: number, maxBytes: number | null): string`: `""` when within the limit or when there is no limit, otherwise `"<name> is X.X MB, over the Y.Y MB limit"`-style text naming both sizes in MB with one decimal.

- [ ] **Step 1: Write the failing tests**

```js
test("mergeRepeats keeps the first of each run of equal frames", () => {
  const f = (file, t, key) => ({ file, t, key });
  expect(
    mergeRepeats([
      f("a", 0, "1"),
      f("b", 100, "1"),
      f("c", 200, "2"),
      f("d", 300, "1"),
    ])
  ).toEqual([f("a", 0, "1"), f("c", 200, "2"), f("d", 300, "1")]);
});
test("withDurations holds each frame until the next, the last until the end", () => {
  expect(
    withDurations(
      [
        { file: "a", t: 0 },
        { file: "b", t: 2500 },
      ],
      3000
    )
  ).toEqual([
    { file: "a", duration: 2.5 },
    { file: "b", duration: 0.5 },
  ]);
});
test("withDurations never goes below 0.02 s", () => {
  expect(
    withDurations(
      [
        { file: "a", t: 0 },
        { file: "b", t: 5 },
      ],
      6
    )[0].duration
  ).toBe(0.02);
});
test("concatList repeats the last file so its duration is used", () => {
  expect(
    concatList([
      { file: "/x/a.png", duration: 1 },
      { file: "/x/b.png", duration: 0.5 },
    ])
  ).toBe(
    "ffconcat version 1.0\nfile '/x/a.png'\nduration 1\nfile '/x/b.png'\nduration 0.5\nfile '/x/b.png'\n"
  );
});
test("concatList escapes quotes in paths", () => {
  expect(concatList([{ file: "/it's here/a.png", duration: 1 }])).toContain(
    "file '/it'\\''s here/a.png'"
  );
});
test("sizeProblem", () => {
  expect(sizeProblem(1_000_000, 2_097_152)).toBe("");
  expect(sizeProblem(5_000_000, null)).toBe("");
  expect(sizeProblem(3_145_728, 2_097_152)).toMatch(/3\.0 MB.*2\.0 MB/);
});
```

- [ ] **Step 2: Run `pnpm test -- --run e2e/helpers/frames.test.js`.** Expected: FAIL, the module does not exist.
- [ ] **Step 3: Implement the four functions in `e2e/helpers/frames.js`.** Pure, with no imports from the other helpers (they load the CLI).
- [ ] **Step 4: Run `pnpm test -- --run e2e/helpers/frames.test.js`.** Expected: PASS.
- [ ] **Step 5: Commit** with the message "Add frame timing helpers for demo recording".

### Task 2: Building the GIF

**Files:**

- Create: `e2e/helpers/gif.js`
- Test: `e2e/helpers/gif.test.js`

**Interfaces:**

- Consumes: Task 1's `mergeRepeats`, `withDurations`, `concatList`, `sizeProblem`.
- Produces: `assemble({ dir: string, output: string, width: number, maxBytes?: number | null, keepFrames?: boolean }): Promise<{ output, bytes, seconds, frames, warnings: string[] }>`. `dir` holds the PNG frames and `frames.json` (`{ frames: {file, t}[], endT }`, with `file` relative to `dir`). It writes `output`, deletes `dir` unless `keepFrames` (or `KEEP_FRAMES=1`), and prints one line: path, seconds, frame count, size in MB, plus any warnings. Warnings: gifsicle missing (`"gifsicle not found; the GIF is not optimised"`), and `sizeProblem()`'s text.

- [ ] **Step 1: Write the failing test.** Skip it when `ffmpeg` is not on the PATH (`test.skipIf`), because CI has no ffmpeg. In a temp folder, write three 64×48 PNG frames with ffmpeg (`-f lavfi -i color=c=red:s=64x48 -frames:v 1`, then blue, then blue again) and a `frames.json` at `t` = 0, 1000, 1500 with `endT` 2000.
  - `assemble({ dir, output, width: 32 })` gives a file at `output` and returns `frames: 2` (the repeated blue is merged) and `seconds: 2`.
  - `ffprobe -show_entries stream=width` on it gives `32`.
  - `dir` no longer exists.
  - A second call with `maxBytes: 10` returns one warning matching `/over the/`.
- [ ] **Step 2: Run `pnpm test -- --run e2e/helpers/gif.test.js`.** Expected: FAIL, the module does not exist.
- [ ] **Step 3: Implement `assemble`.**
  - The frame `key` is the SHA-1 of each PNG's bytes.
  - Write `concat.txt` in `dir` with absolute paths.
  - Run ffmpeg through `execFile` (arguments as an array): `-y -f concat -safe 0 -i concat.txt -vf "scale=<width>:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -fps_mode vfr <output>`.
  - Then, when found on the PATH, run `gifsicle -O3 --batch <output>`.
  - Read the duration back with `ffprobe` rather than summing the durations.
- [ ] **Step 4: Run `pnpm test -- --run e2e/helpers/gif.test.js`.** Expected: PASS. Then `pnpm test -- --run` passes as a whole.
- [ ] **Step 5: Commit** with the message "Build demo GIFs from recorded frames".

### Task 3: The in-app recorder

First, verify the two open questions from the spec: background capture and recording the settings popout. The tests below are that verification.

**Files:**

- Create: `e2e/helpers/recorder.js`
- Test: `e2e/recorder.e2e.js` (run by `pnpm test:e2e`)

**Interfaces:**

- Consumes: `evalJs`, `evalJson`, `startAsync`, `waitFor`, `REPO_ROOT` from `./obsidian`; `guardVault` from `./vault`.
- Produces:

  - `OUT_DIR = path.join(REPO_ROOT, "e2e", "demos", "out")`.
  - `resolveTarget(target: "main" | "settings"): Promise<void>`. In the app, it stores the target's `BrowserWindow` on `window.__demoTarget` and its document on `window.__demoDoc` (`document`, or `app.setting.modalEl.ownerDocument`), or throws `Error("The settings window is not open")` / `Error("Could not find <target> window of this vault")`.
    - `"main"`: `require("@electron/remote").getCurrentWindow()`.
    - `"settings"`: needs `app.setting.isOpen`. It sets the settings document's `title` to a random token, takes the one window from `BrowserWindow.getAllWindows()` whose `getTitle()` equals the token (refusing unless exactly one matches), then restores the title.
  - `startRecording({ name: string, target?: "main" | "settings", fps?: number = 10, maxMs?: number = 60000 }): Promise<{ dir: string }>`.
    - Calls `guardVault()`, then empties and creates `OUT_DIR/<name>/frames`, then calls `resolveTarget(target)`.
    - Injects `<style id="demo-no-blink">.cm-cursorLayer{animation:none!important}</style>` into the target document.
    - Calls `setBackgroundThrottling(false)` on the target's `webContents`.
    - Starts the loop with `startAsync`. Each pass: `capturePage()`, then `toPNG()`, then write `frame-<6-digit index>.png`, recording `t` as ms since the start. It waits `max(0, 1000/fps - elapsed)` before the next pass and stops on `window.__demoRecorder.stop` or after `maxMs`.
  - `stopRecording(): Promise<{ dir, frames: {file, t}[], endT }>`. Sets the stop flag, waits with `waitFor` until the loop has finished, writes `frames.json`, removes the style and restores throttling.
  - `isRecording(): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests in `e2e/recorder.e2e.js`.** Each test starts with `reset({ notes: standardNotes() })`, and `afterEach` calls `stopRecording()` when `isRecording()`, then `expectNoErrors`.
  - **"captures a change made while recording":** record `name: "e2e-recorder"` for about 1 s with a full-window red `div` added halfway (then removed). Some frame differs from the first (compare SHA-1 of the bytes) and `frames.length >= 5`. Leave a comment in the test that it is meant to pass while Obsidian is behind other windows.
  - **"starts from an empty frames folder":** record twice under one name. The second `frames.json` lists only files that exist, and no file is left over from the first run (count the PNGs and compare with `frames.length`).
  - **"stops on its own after maxMs":** record with `maxMs: 500` without calling stop. `waitFor(() => !isRecording())` succeeds within 5 s.
  - **"records the settings window":** after `openSettings()`, `startRecording({ target: "settings" })` captures frames whose PNG size matches the settings window's `getContentSize()` times its scale factor, not the main window's.
  - **"refuses to record settings when the settings window is closed":** rejects with `/settings window is not open/` and creates no frames.
- [ ] **Step 2: Run `pnpm test:e2e -- e2e/recorder.e2e.js`.** Expected: FAIL, the module does not exist.
- [ ] **Step 3: Implement `e2e/helpers/recorder.js`.**
- [ ] **Step 4: Run `pnpm test:e2e -- e2e/recorder.e2e.js` with Obsidian behind other windows.** Expected: PASS.
  - If "captures a change" fails only while Obsidian is hidden, change `startRecording` to throw `"Recording needs the Obsidian window visible: bring it to the front and run again"` when `target.isVisible()` is false or `target.isMinimized()` is true. Add a test that skips when the window is visible. Note the finding in the spec's "Left to the builder" section.
  - If the settings window cannot be captured, stop and report to the user: the rules clip in Task 6 depends on it.
- [ ] **Step 5: Commit** with the message "Record Obsidian's windows from inside the app".

### Task 4: Window size, side panels and the pointer

**Files:**

- Create: `e2e/helpers/pointer.js`
- Test: `e2e/pointer.e2e.js`

**Interfaces:**

- Consumes: `resolveTarget` from Task 3 (sizing acts on `window.__demoTarget` only); `setOutcome` from `./rollover`.
- Produces (every `el` argument is a JS expression string, evaluated in the main window like the existing helpers, that returns an element in `window.__demoDoc`; the pointer lives in `window.__demoDoc`, so `resolveTarget()` must run first):

  - `prepareWindow({ width: number, height: number, collapsePanels?: boolean = false }): Promise<void>`. Main window only: it calls `resolveTarget("main")` itself. It stores the current bounds and the panels' collapsed state on `window.__demoSaved`, calls `setSize(width, height)`, waits until `innerWidth === width`, and collapses `app.workspace.leftSplit` / `rightSplit` when asked.
  - `restoreWindow(): Promise<void>`. Restores what `prepareWindow` saved, and does nothing when nothing was saved.
  - `showPointer(): Promise<void>`: adds `#demo-pointer`, an SVG arrow, `position: fixed`, `pointer-events: none`, `z-index: 2147483647`, starting at the window's centre.
  - `moveTo(el: string, ms?: number = 400): Promise<void>`: CSS transition to the element's centre, resolving after `ms`.
  - `click(el: string): Promise<void>`: `moveTo`, a ripple, a 150 ms hold, then `element.click()`.
  - `choose(label: string, outcome: string): Promise<void>`: `moveTo` the review row's `<select>`, a ripple, `setOutcome(label, outcome)`, then an accent outline on the select for 600 ms.
  - `pause(ms: number): Promise<void>`: a plain `setTimeout` in Node.
  - `removePointer(): Promise<void>`: removes `#demo-pointer` and any ripple.

- [ ] **Step 1: Write the failing tests in `e2e/pointer.e2e.js`.** Each starts with `reset({ notes: standardNotes() })`, and `afterEach` calls `removePointer()`, `restoreWindow()`, then `expectNoErrors`.
  - **"prepareWindow sizes the window and restoreWindow puts it back":** `innerWidth` becomes 960 after `prepareWindow({ width: 960, height: 600, collapsePanels: true })`, and `app.workspace.leftSplit.collapsed` is true. After `restoreWindow()`, the outer width and the collapsed state are back to their values from before.
  - **"the pointer moves to an element's centre":** after `showPointer()` and `moveTo("document.querySelector('.workspace-ribbon')")`, the pointer's tip is within 2 px of that element's bounding-box centre.
  - **"removePointer leaves nothing behind":** `document.querySelectorAll('#demo-pointer, .demo-ripple').length === 0`.
- [ ] **Step 2: Run `pnpm test:e2e -- e2e/pointer.e2e.js`.** Expected: FAIL.
- [ ] **Step 3: Implement `e2e/helpers/pointer.js`.** Styles go in one injected `<style id="demo-pointer-style">`, removed by `removePointer()`. The ripple and outline use `var(--interactive-accent)`.
- [ ] **Step 4: Run `pnpm test:e2e -- e2e/pointer.e2e.js`.** Expected: PASS. Then `pnpm test:e2e` passes as a whole.
- [ ] **Step 5: Commit** with the message "Add a demo pointer and window sizing".

### Task 5: The demo runner

**Files:**

- Create: `vitest.demo.config.js`, `e2e/helpers/demo.js`
- Modify: `package.json` (scripts), `.gitignore`
- Test: `e2e/demo.e2e.js`; a throwaway `e2e/demos/private/smoke.demo.js` (gitignored)

**Interfaces:**

- Consumes: Tasks 2–4.
- Produces:

  - `record(name: string, { target?, width?, height?, collapsePanels?, outputWidth?, maxBytes? }, steps: () => Promise<void>): Promise<{ output, bytes, seconds, warnings }>`. In order: `resolveTarget(target ?? "main")`, `prepareWindow` (only for the main target and only when `width` is given), `showPointer`, `startRecording`, `await steps()`, `pause(800)` so the final state is held, `stopRecording`, `removePointer`, `restoreWindow`, then `assemble({ dir, output: OUT_DIR/<name>.gif, width: outputWidth ?? width ?? 960, maxBytes })`.
  - `cleanupDemo(): Promise<void>`: `stopRecording` when `isRecording()`, then `removePointer`, `restoreWindow`, then `closeModals`. Safe to call when nothing is running. Demo files call it in `afterEach`.

- [ ] **Step 1: Write the failing test in `e2e/demo.e2e.js`.**
  - **"cleanupDemo restores everything after a failed demo":** call `record("e2e-cleanup", { width: 960, height: 600, collapsePanels: true }, () => { throw new Error("boom") })` and expect it to reject with `"boom"`. Then call `cleanupDemo()`. Afterwards `isRecording()` is false, there is no `#demo-pointer`, there is no `#demo-no-blink` style, and the window width is the same as before.
- [ ] **Step 2: Run `pnpm test:e2e -- e2e/demo.e2e.js`.** Expected: FAIL.
- [ ] **Step 3: Implement the runner.**
  - Implement `e2e/helpers/demo.js`.
  - `vitest.demo.config.js` is `vitest.e2e.config.js` with `include: ["e2e/demos/**/*.demo.js"]` and `testTimeout: 180000`.
  - `package.json` gets `"demo": "vitest run --config vitest.demo.config.js"`.
  - `.gitignore` gets an `# e2e demos` block with `e2e/demos/private/` and `e2e/demos/out/`.
- [ ] **Step 4: Run `pnpm test:e2e -- e2e/demo.e2e.js`.** Expected: PASS.
- [ ] **Step 5: Smoke run.**
  - Write `e2e/demos/private/smoke.demo.js`: reset with standard notes, `record("smoke", { width: 960, height: 600 }, ...)` running the review command, `choose` one row, `click` Cancel.
  - Run `pnpm demo smoke`. Expected: one line naming `e2e/demos/out/smoke.gif`, and the file exists.
  - `git status --short` shows no file under `e2e/demos/`.
  - `pnpm test -- --run` and `pnpm test:e2e` run no `*.demo.js` file: check the file list in verbose output.
- [ ] **Step 6: Commit** `vitest.demo.config.js`, `e2e/helpers/demo.js`, `e2e/demo.e2e.js`, `package.json` and `.gitignore` with the message "Add pnpm demo to record scripted demos".

### Task 6: Private clip of adding a rule

Proves the settings window can be recorded (a success criterion). Nothing in this task is committed.

**Files:**

- Create: `e2e/demos/private/add-rule.demo.js` (gitignored)

- [ ] **Step 1: Write the demo.**
  - Reset with standard notes, then `openSettings()` and `scrollRulesIntoView()`.
  - `record("add-rule", { target: "settings" }, ...)`. In the steps: `click` Add rule, then fill the fields one call at a time with a `moveTo` and `pause(700)` before each. `fillRuleDialog` skips fields left undefined, so call `fillRuleDialog({ match: "tag" })`, then `({ value: "#errand" })`, `({ effect: "move" })`, `({ target: "## Errands" })`. Then `click` Save and pause on the new row.
  - The pointer lives in `window.__demoDoc`, which `record()` sets to the settings document, so it shows in the settings window.
- [ ] **Step 2: Run `pnpm demo add-rule`.** Expected: `e2e/demos/out/add-rule.gif` is written, and in it the dialog opens, its fields fill and the new row appears. Open the GIF with Read to check it before handing it over.
- [ ] **Step 3: Give the user the absolute path of `add-rule.gif`** as the first private clip. Stop for their reaction before Task 7: it is the first real look at pacing and pointer style, which the README demo reuses.

### Task 7: The README demo

**Files:**

- Create: `e2e/demos/readme.demo.js`, `e2e/fixtures/notes/demo-previous.md`, `e2e/fixtures/notes/demo-template.md`

**Interfaces:**

- Consumes: `record`, `cleanupDemo`, `pause`, `click`, `choose`, `moveTo` (Tasks 4–5); `reset`, `day`, `fixture` from `./vault`; `openToday`, `waitForReview`, `waitForIdle` from `./rollover`; `EXAMPLE_RULES` from `../../src/rules`.

- [ ] **Step 1: Write the fixtures.**

  - `demo-template.md` is a short daily template with none of the previous note's headings, so that the rollover recreates them.
  - `demo-previous.md` holds everyday todos under `## Work` and `## Home`, including:

    - one already-done todo;
    - `- [ ] Send the quarterly report [rolled:: 5]` (stale at the default `staleAfterRollovers` of 5);
    - `- [ ] Review Sam's pull request` (the one cancelled on screen);
    - `- [ ] Learn Italian #someday`;
    - one todo with a nested child.

    Keep it to about 8 lines, so that the dialog fits a 600 px tall window without scrolling.

- [ ] **Step 2: Write `readme.demo.js`.**

  - Settings: `templateHeading: "none"`, `rolloverChildren: true`, `trackRolloverCount: true`, `reviewOnAutoRollover: "stale"`, `staleBehavior: "backlog"`, `backlogNotePath: "Backlog.md"`, and `rules: EXAMPLE_RULES` with only `example-1` (`#someday`) enabled.
  - `record("readme", { width: 960, height: 600, collapsePanels: true, maxBytes: 2_097_152 }, steps)`.
  - The steps, in order:

    1. Open yesterday's note and `pause(2000)`.
    2. `openToday()`, then `waitForReview()`, then `pause(2500)` with the stale and rule badges in view.
    3. `choose("Review Sam's pull request", "cancel")`, then `pause(1500)`.
    4. `click` Apply, then `waitForIdle()`, then `pause(3000)` on today's note.
    5. Open `Backlog.md` and `pause(2000)`.

    That totals about 15–20 s.

- [ ] **Step 3: Run `pnpm demo readme`.** Expected: no size warning, about 15–20 s. Open the GIF with Read to check that the badges, the summary change and today's headings are legible. If it is over 2 MB, lower `outputWidth` or `fps` (or the window size) before anything else, and record the values used.
- [ ] **Step 4: Stop for the user.** Give them the absolute path of `e2e/demos/out/readme.gif` to watch. Re-record on their feedback; rejected versions are never committed.
- [ ] **Step 5: Commit** `readme.demo.js` and both fixtures with the message "Add the README demo script".

### Task 8: Replace demo.gif and document demos

Only after the user has approved `readme.gif` in Task 7.

**Files:**

- Modify: `demo.gif`, `README.md:14`, `CLAUDE.md`, `CONTRIBUTING.md` (section "Testing in Obsidian")

- [ ] **Step 1: Copy `e2e/demos/out/readme.gif` over `demo.gif`.** In the README, change the alt text to describe it: "Daily Catch-Up rolling over yesterday's todos: the review dialog flags a stale todo and a #someday todo for the backlog, one todo is cancelled, and today's note gets the rest under their headings".
- [ ] **Step 2: Update CLAUDE.md.**
  - Under **Commands**: `pnpm demo <name>   # record e2e/demos/<name>.demo.js as e2e/demos/out/<name>.gif (needs Obsidian open with e2e-vault)`.
  - Under **End-to-end tests**: bullets for `frames.js`, `gif.js`, `recorder.js`, `pointer.js`, `demo.js`, `vitest.demo.config.js`, `e2e/demos/` (with `private/` and `out/` gitignored), and the new e2e files.
  - After "Plans write an e2e test…": one line saying that Claude offers a private review clip (`e2e/demos/private/`, never committed) for visual or interactive features.
- [ ] **Step 3: Update CONTRIBUTING.md.** Add a "Recording demos" subsection under "Testing in Obsidian" covering:

  - `pnpm demo readme`;
  - ffmpeg is required and gifsicle optional;
  - watch `e2e/demos/out/readme.gif` before copying it over `demo.gif`;
  - the 2 MB limit.

  Add the `pnpm demo` line to the command list near line 15.

- [ ] **Step 4: Run `pnpm test -- --run`, then `pnpm format`.** Expected: PASS, and no stray formatting changes outside these files.
- [ ] **Step 5: Commit** with the message "Replace the README demo with a recording of Daily Catch-Up".
