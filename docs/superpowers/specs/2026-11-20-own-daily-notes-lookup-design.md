# Own the daily-notes lookup

Design for step 3 of Phase 3 in `docs/roadmap.md`: replace `obsidian-daily-notes-interface` with the plugin's own `src/daily-notes.js`, so that one piece of code decides which files are daily notes. "Gather from the last N days" (step 4) builds on it. Written on 2026-11-20; a small change, approved by the user as proposed.

## Intent

The library is a personal package that went without a release from 2021-09 to 2026-05, and 0.9.4 pins its `obsidian` dependency to a GitHub tarball. The plugin also has two definitions of "a daily note" that disagree:

- **Today's note, from a command:** the library's `getAllDailyNotes()` + `getDailyNote()`. They search every subfolder of the daily folder and match by **file name** against the last segment of the format. `rollover()` then rejects any file that is not at exactly `folder/<today in format>.md`.
- **The previous note:** `getLastDailyNote()` in `index.js`. It matches the **path inside the folder** against the full format, through a regex built from the folder, and returns `sorted[1]` of the notes dated on or before today.

Bugs in the current code that this fixes:

- The folder goes into the regex unescaped (`Daily (work)` never matches, so no previous note is found), and the `.` in `.md$` matches any character.
- `getAllDailyNotes()` throws `DailyNotesFolderMissingError` when the daily folder doesn't exist, and the command doesn't catch it.
- If two files carry today's date (say `daily/2026-11-20.md` and `daily/old/2026-11-20.md`), the library keeps whichever it saw last. If that's the wrong one, `rollover()` rejects it and the command silently does nothing.

## Goals

1. One module, `src/daily-notes.js`, is the only code that reads the daily-notes settings or decides whether a file is a daily note and what its date is.
2. Its date logic is pure and unit tested.
3. `obsidian-daily-notes-interface` is removed from `package.json`.
4. The `obsidian` dev dependency is pinned to an npm version (`1.14.4`, the version the tarball currently resolves to) instead of `obsidian-api/tarball/master`.
5. Step 4 can list the daily notes, with their dates, newest first.

## Non-goals

- Reading the settings format of the Periodic Notes 1.x beta (calendar sets). The library doesn't read it either. Periodic Notes' `settings.daily` stays supported as now.
- Weekly, monthly or other periodic notes.
- Creating daily notes.

## Anti-goals

- Any change in which note rolls into which for a vault that works today. The e2e baselines must pass unchanged.

## Approaches

1. **Strict path definition (chosen).** A file is a daily note when its path inside the daily folder, with `.md` removed, parses strictly with the full format. This is the path Daily Notes itself creates, and both callers already end up enforcing it (the command through `rollover()`'s exact-path check, the previous-note lookup through its regex). So it changes no outcome for a working vault, and only removes the bugs above.
2. **The library's file-name definition.** Match the basename against the format's last segment anywhere under the folder. It would count `daily/archive/2026-01-03.md` as a daily note, which step 4 should not inherit by accident, and `rollover()` would still need its exact-path check on top.
3. **Keep the library, bump it to 0.9.5.** This removes neither the second definition nor the bugs.

## Design

### `src/daily-notes.js`, pure part

`moment` is passed in, never read from `window`, so the tests can use the real library.

- `cleanFolder(folder)`: the folder with surrounding whitespace and leading or trailing `/` removed (`""` for the vault root). Replaces `getCleanFolder()` in `index.js`.
- `noteDate(path, { folder, format }, moment)`: the note's date as a moment, or `null`. `null` when the path is not inside the folder (the folder is followed by `/`, so `daily` does not match `daily-old/…`), does not end in `.md`, or the rest does not parse strictly (`moment(rest, format, true)`). Plain string operations, no regex built from user text.
- `todayNotePath({ folder, format }, today)`: `folder/<today formatted>.md`, or `<today formatted>.md` at the root.
- `dailyNotes(files, settings, moment)`: `[{ file, date }]` for each file with a `noteDate`, newest first. Files are anything with a `path`.
- `previousDailyNote(files, settings, today, moment)`: the newest daily note dated before `today`'s day, or `null`. This replaces `sorted[1]`. In a rollover, today's note always exists and sorts first among notes on or before today, so the result is the same note; it no longer depends on that.

### `src/daily-notes.js`, Obsidian part

These are thin. They take `app` as a parameter, so they are unit tested against fake `app` objects. That is the only way Periodic Notes gets covered, since the e2e vault doesn't have it.

- `getDailyNoteSettings(app)`: `{ folder, format, template }` from Periodic Notes' `settings.daily` when that plugin is loaded with daily notes enabled, else from `internalPlugins.getPluginById("daily-notes")?.instance?.options`. Defaults: format `YYYY-MM-DD`, folder and template `""`, each trimmed, as the library does. Returns `null` when reading throws. The folder is returned through `cleanFolder()`.
- `isDailyNotesEnabled(app)`: moved from `index.js` unchanged.

### Callers

- `index.js` `rollover()`: reads the settings with `getDailyNoteSettings(this.app)`. On a command run it finds today's note at `todayNotePath()` with `vault.getAbstractFileByPath()` (a `TFile`, or the command stops as it does now when there is none), instead of the library. The checks "is a daily note" and "is today's daily note" become `file.path === todayNotePath(…)`.
- `index.js` `getLastDailyNote()`: `previousDailyNote(this.app.vault.getMarkdownFiles(), settings, window.moment(), window.moment)`. `getFileMoment()` and `getCleanFolder()` go.
- `RolloverSettingTab.getTemplateHeadings()`: `getDailyNoteSettings(this.app)` for the template path.

### Dependencies

- Remove `obsidian-daily-notes-interface`.
- Pin `obsidian` to `1.14.4` from npm.
- Add `moment` `2.31.0` (the version `obsidian` 1.14.4 depends on) as a dev dependency, for the unit tests only. It is never bundled: the module receives `window.moment` at runtime.

### Tests

- `src/daily-notes.test.js`: `noteDate` with root and nested folders, a folder with regex characters (`Daily (work)`), a sibling folder sharing the prefix, a format containing `/` (`YYYY/MM/YYYY-MM-DD`), a file in a subfolder the format doesn't describe, non-`.md` files, and strict parsing (`2026-11-5` against `YYYY-MM-DD`). `todayNotePath` at the root and in a folder. `dailyNotes` ordering. `previousDailyNote` skipping today and future-dated notes, with no earlier note, and with only today's note. `getDailyNoteSettings` with Daily Notes options, never-configured defaults, Periodic Notes on and off, and a throwing `app`. `isDailyNotesEnabled`.
- `e2e/daily-notes.e2e.js`, against the real app, with the daily-notes options changed for the test and put back afterwards:
  - a daily folder named `Daily (work)` rolls the previous note's todos;
  - the format `YYYY/MM/YYYY-MM-DD` rolls through the command across a month boundary in the folder layout (previous note in another `MM` folder);
  - "Roll over todos now" with a daily folder that doesn't exist shows no captured error.
- The existing e2e suite (baselines included) passes unchanged.

### Docs

- `CLAUDE.md`: add `src/daily-notes.js` to the core files and `src/daily-notes.test.js` / `e2e/daily-notes.e2e.js` to testing.
- `docs/roadmap.md`: tick "Own the daily-notes lookup".

## Left to the builder

- Helper names inside `daily-notes.js` beyond the exports above.
- How the e2e file switches the daily-notes options and restores them (probably the same `instance.options` assignment `bootstrap()` uses).
