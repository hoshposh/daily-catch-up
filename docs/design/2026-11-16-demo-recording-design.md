# Recording demos of the plugin

Design for a scripted way to record short animated demos of the plugin running in Obsidian. Brainstormed on 2026-11-16. Decisions made in that conversation are marked (decided); everything else is a call made from the code and a probe of the running app, listed under [Calls to check](#calls-to-check).

## Intent

Two uses, two audiences (decided):

1. **The public README demo.** `demo.gif` in the repo root is upstream's from 1.0.0 (2020): 3.4 s, 1920×1080, 186 KB, showing only the original basic rollover. It shows none of what makes this plugin worth installing (the review dialog, the backlog, aging, rules). A new one replaces it, for people deciding whether to install.
2. **Private review clips.** When a new feature is easier to show than to describe (rules was the example given), Claude records a short clip for the user to watch while reviewing the work. These are never committed and never public, and they are made only when showing helps, not for every feature.

Success looks like:

- `demo.gif` is replaced on this branch by a recording of this plugin, after the user has watched it, and can be re-recorded with one command after a UI change.
- Claude can produce a private clip of a feature branch with one command, without the user starting anything, and hand over its path.
- One private clip of the Rules settings (adding a rule) is recorded as proof that the settings window can be recorded, not only the main window.

## Goals

1. One recording pipeline for both uses: a demo script drives Obsidian with the e2e helpers while an in-app recorder captures the window; frames become a GIF.
2. `pnpm demo <name>` runs one demo and writes its GIF.
3. The public demo is a single main GIF of about 15–20 s (decided: option A, not one GIF per feature).
4. A visible pointer and click ripple, so viewers can follow what is clicked.

## Non-goals

- One public GIF per feature (decided against; can be added later if a feature proves hard to explain).
- Video (MP4), sound, narration, text captions.
- Running in CI or headless; like the e2e suite, it needs Obsidian open with `e2e-vault`.
- Real screen recording (Spectacle, OBS). On KDE Wayland every recording needs a permission dialog, so Claude cannot start one unattended. The user can still use Spectacle themselves.

## Anti-goals

- Anything from the user's own vaults appearing in a recording. Demos run only in `e2e-vault`, behind the same guard as the e2e suite, with their own fixture notes.
- Replacing `demo.gif` without the user having watched the new one.
- Private clips or raw frames ending up in git.
- Affecting `pnpm test` or `pnpm test:e2e`: demos are not tests, are never picked up by either run, and leave the app as the e2e suite expects it (window size, no pointer, recorder stopped).
- A large repo. `.git` is 6.1 MB today; each re-recording of a committed GIF adds its full size to history.

## Approaches

1. **Continuous in-app recording** (chosen). Code running inside Obsidian captures its own window about 10 times a second while the demo script drives it with deliberate pauses; frames where nothing changed are merged, so a pause becomes one held frame. Shows real motion (the dialog opening, the summary updating, the note changing), which matters most for the README, whose job is to persuade. Costs: more raw frames, timing set by the script's pacing rather than exact, and background capture still to be confirmed.
2. **A screenshot after each step**, each held for a set time. Small, predictable files, full control of timing, but no motion: states jump, which sells the plugin poorly.
3. **Screen recording with Spectacle.** True video with the real pointer, but needs the Wayland permission dialog each time, so it cannot run unattended. Ruled out as the pipeline.

The Chrome DevTools screencast (`Page.startScreencast`) was dropped: it streams events, which the one-shot `obsidian dev:cdp` command cannot receive, so it would mean restarting Obsidian with a remote-debugging port. Approach 1 gets the same frames without that.

## What exists today

- **The e2e harness** (`e2e/helpers/`, see `docs/design/2026-11-15-e2e-tests-design.md`): `reset()` puts `e2e-vault` in a known state with given notes and settings; `bootstrap()` builds the current branch into the vault's own plugin folder; `openToday()`, `runCommand()`, `setOutcome()`, `clickButton()`, `waitForReview()`, `waitForIdle()` drive a rollover; `settings-tab.js` drives the settings window and rule dialog; `startAsync()` / `awaitAsync()` run async code in the app.
- **Probe of the running app (2026-11-16):** in `eval`, `require("@electron/remote").getCurrentWebContents()` is available, with `capturePage()` and `beginFrameSubscription()`, and `require("fs")` works. 20 sequential `capturePage()` + `toPNG()` + `writeFileSync` at the window's full size (2030×1000) took 1.56 s, about 13 frames per second. `dev:cdp method=Page.captureScreenshot` also works.
- **Tools:** ffmpeg is installed with the `gif`, `libwebp_anim` and `apng` encoders. gifsicle 1.96 is in apt but not installed. gifski is not in apt.
- **The settings window is a popout window** in Obsidian 1.15, with its own document and web contents. Capturing the main window does not capture it.
- **Native dropdowns:** on Linux the review dialog's `<select>` lists open in a native popup that window capture does not see. `setOutcome()` sets the value directly, so a recording shows the value change without the list opening.

## Design

### Layout

```txt
e2e/
  demos/
    readme.demo.js        # the public demo (committed)
    private/              # private clip scripts (gitignored)
    out/                  # frames and GIFs (gitignored)
  helpers/
    recorder.js           # in-app recorder: start, stop, assemble
    pointer.js            # fake pointer, click ripple, change highlight, pause
  fixtures/notes/
    demo-previous.md      # the public demo's previous-day note
vitest.demo.config.js
```

`.gitignore` gains `e2e/demos/private/` and `e2e/demos/out/`.

### Runner

`package.json` gains `"demo": "vitest run --config vitest.demo.config.js"`, so `pnpm demo readme` runs `e2e/demos/readme.demo.js` (vitest filters files by the name given). Vitest is the runner rather than plain Node because the helpers import without file extensions, which only vite's resolution handles, and because it gives the same global setup and teardown as the e2e suite.

`vitest.demo.config.js` includes `e2e/demos/**/*.demo.js`, runs one file at a time, uses the e2e `globalSetup` (bootstrap, guard of the repo-root `main.js` and `data.json`, restoring the viewport and mobile mode), and has long timeouts. The unit config and `vitest.e2e.config.js` must not match `*.demo.js`.

Each demo file is one test: `reset()` with its notes and settings, prepare the window, start recording, drive the steps, stop, assemble. An `afterEach` always stops the recorder, removes the pointer and restores the window, even when a step failed.

### Recorder (`recorder.js`)

- `startRecording({ name, target = "main", fps = 10 })` starts a loop in the app (via `startAsync`) that calls `capturePage()` on the target window's web contents, writes each PNG to `e2e/demos/out/<name>/frames/` with its capture time, and waits for one capture to finish before starting the next. `target` is the main window or the settings popout window.
- **Only `e2e-vault`'s own windows.** One Obsidian app runs every open vault, so `BrowserWindow.getAllWindows()` can include the windows of the user's own vaults. The recorder never picks a window from that list. It resolves the target from the e2e vault's own documents: the main window from the document `eval` runs in, the settings window from `app.setting.modalEl.ownerDocument`. Before recording, and before any `setSize()`, it checks that the window it resolved belongs to the vault the guard approved (for example that its document is the one `app` lives in or the settings document of that `app`), and refuses otherwise. This check has a test.
- The loop stops itself after a maximum duration (for example 60 s), so a crashed runner never leaves it filling the disk.
- `stopRecording()` sets the stop flag, waits for the last write, and returns the frame list with times.
- While recording, the editor caret's blinking is turned off with injected CSS, so a still screen gives identical frames. The CSS is removed afterwards.
- `assemble({ name, width })` turns frames into `e2e/demos/out/<name>.gif`: merges consecutive frames that are identical or nearly so, gives each remaining frame the time until the next one, writes an ffmpeg concat list with those durations, scales to `width` with a good filter, uses a generated palette, then runs gifsicle `-O3` when it is installed (a warning when it is not). It prints the GIF's path, duration and size. Raw frames are deleted afterwards unless `KEEP_FRAMES=1`.
- The pure parts (merging frames, durations, the concat list, the size check) live in plain functions with unit tests in `e2e/helpers/*.test.js`, which `pnpm test` already runs.

### Window

Before recording, the demo lays the page out at the demo's size with the DevTools device-metrics override (the one `setViewportWidth()` uses), and clears it afterwards. _Changed during the build:_ the design first resized the real window with `BrowserWindow.setSize()`, because it was unknown whether `capturePage()` honours the override. It does (an 880×720 override captures as 1100×900 at a 1.25 scale factor, laid out at that size). Resizing turned out to be unreliable on KDE Wayland: the compositor can refuse a resize, and a resize of a window behind others only lands once it draws a frame, so a demo could leave Obsidian at the demo's size. The override never touches the real window, and the e2e global teardown clears it even after an interrupted run. The public demo collapses the side panels so the note and dialog fill the frame, which also keeps the vault switcher (showing `e2e-vault`) out of view.

### Pointer and pacing (`pointer.js`)

- An injected SVG arrow (fixed position, `pointer-events: none`, top z-index) in the target window's document. `moveTo(selector)` animates it to the element's centre over about 400 ms.
- `click(selector)` moves the pointer there, shows a ripple, then clicks through the same code path as the e2e helpers.
- `choose(label, outcome)` moves to that row's dropdown, shows the ripple, sets the outcome with `setOutcome()`, and briefly outlines the dropdown, since the native list cannot be recorded.
- `pause(ms)` holds the screen for viewers. This is the only fixed wait: waiting for the app is still done with `waitFor()`, as in the e2e suite.

### The public demo (`readme.demo.js`)

Story, about 15–20 s, light theme (the default `reset()` sets):

1. Yesterday's note with unfinished todos under a few headings, one of them already rolled several times.
2. Today's note is created the way a user does (`openToday()`); the review dialog opens on its own because a todo is stale. The stale badge and a rule badge (`#someday` → Backlog) are visible.
3. The pointer changes one todo to Cancel; the summary updates.
4. The pointer clicks Apply.
5. Today's note shows the rolled todos under their headings, with `[rolled:: n]`; a brief look at the backlog note with its `[from:: …]` link.

Settings: `trackRolloverCount` on, `reviewOnAutoRollover: "stale"`, `staleBehavior: "backlog"`, a backlog note path, `rolloverChildren` on, the `#someday` example rule switched on, template heading as in the fixture template. The fixture `demo-previous.md` uses everyday, readable todos and is only used by demos (changing the e2e fixtures would change the e2e baselines).

Output: `e2e/demos/out/readme.gif`, at most 2 MB, with text legible at GitHub's README width (about 830 px). Replacing `demo.gif` happens on this branch, as its last step, and only after the user has watched `out/readme.gif`: the plan stops there for the user. Attempts the user rejects stay in the gitignored `out/` folder, so only the approved GIF is ever committed and history grows by one GIF. Then it is copied over `demo.gif`, and the README's alt text is updated to describe what the new GIF shows.

### Private clips

When a feature would be clearer shown than described, Claude writes `e2e/demos/private/<feature>.demo.js` on the feature branch, runs `pnpm demo <feature>`, and gives the user the absolute path of `e2e/demos/out/<feature>.gif` (VS Code previews GIFs). Private clips get less polish: default window size, pointer on, no size limit beyond being reasonable. The script is throwaway; neither it nor the GIF is committed. The feature's e2e tests still do the verifying; a clip is only for seeing it.

Claude offers a clip when a feature is mostly visual or interactive (dialogs, settings, layout), for example when presenting a finished branch; the user can also ask for one at any time.

### Dependencies

gifsicle (`sudo apt install gifsicle`) for smaller GIFs; the user installs it. ffmpeg is already installed. No new npm dependencies.

### Docs

- CLAUDE.md: a **Commands** line for `pnpm demo <name>`; the demo files under **End-to-end tests**; a line in the process notes that private review clips are offered for visual features and never committed.
- CONTRIBUTING.md: how to re-record the README demo and the review step before replacing `demo.gif`.

## Calls to check

- Vitest as the runner (`pnpm demo`), with its own config, sharing the e2e global setup.
- Layout: demos under `e2e/demos/`, private scripts and all output gitignored.
- Recording the real window size with `setSize()` rather than the device-metrics override.
- Public demo in the light theme, side panels collapsed, at most 2 MB, aimed at about 830 px wide.
- The public demo's story and settings (stale todo opens the review, `#someday` rule on, one Cancel, a look at the backlog).
- `demo.gif` keeps its path in the repo root, so the README link and any external links keep working.
- `demo.gif` is replaced on this branch, after the user has watched the new one; rejected attempts are never committed.
- The recorder finds windows through the e2e vault's own documents, never from the app-wide window list, and checks the window before recording or resizing, in case the user's own vaults are open in the same app.
- gifsicle optional (a warning when missing) rather than required.
- Claude offers private clips for visual or interactive features rather than for every feature.
- Work on its own branch, `feat/demo-recording`, in a worktree from `main`.

## Left to the builder

- **Verify first:** that `capturePage()` returns fresh frames while the Obsidian window is behind other windows or on another desktop (try `webContents.setBackgroundThrottling(false)` if not). If it cannot, recording needs the window visible, and the runner says so before it starts.
- **Verify first:** that the settings popout window's web contents can be captured, and the pointer injected into its document.
- How "nearly identical" frames are detected (ffmpeg `mpdecimate`, or comparing pixels in Node).
- Exact window size, output width, frame rate, palette and dither settings, and gifsicle flags, within the size and legibility targets.
- Pointer artwork, animation timing and ripple style.
- The exact todos in `demo-previous.md` and the pacing of each step, within the story and length above.
- How HiDPI scaling (`capturePage()` returns device pixels) is handled when scaling to the output width.
