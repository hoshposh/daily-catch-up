# Own the Daily-Notes Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `obsidian-daily-notes-interface` and `getLastDailyNote()`'s own regex with one module, `src/daily-notes.js`, that reads the daily-notes settings and decides which files are daily notes.

**Architecture:** A pure part (dates from paths, ordering, today's path, the previous note), with `moment` passed in, and a thin part that reads Daily Notes or Periodic Notes settings from an `app` passed in. Both are unit tested, the settings reader against fake `app` objects. `index.js` and the settings tab call the module. The library goes, and `obsidian` is pinned to an npm version.

**Tech Stack:** JavaScript (ES modules, bundled to CommonJS by rollup), vitest, moment (tests only; Obsidian provides `window.moment` at runtime), the e2e harness in `e2e/`.

**Spec:** `docs/superpowers/specs/2026-11-20-own-daily-notes-lookup-design.md`

## Global Constraints

- A file is a daily note when its path inside the daily folder, with `.md` removed, parses strictly (`moment(rest, format, true)`) with the full format. No regex built from user text.
- Settings defaults: format `YYYY-MM-DD`, folder `""`, template `""`, each trimmed. Periodic Notes' `settings.daily` wins when `app.plugins.getPlugin("periodic-notes")?.settings?.daily?.enabled`.
- `src/daily-notes.js` never imports `moment` or reads `window`. Callers pass `window.moment` and `this.app`.
- Dependencies: remove `obsidian-daily-notes-interface`. `"obsidian": "1.14.4"`. Dev dependency `"moment": "2.31.0"`.
- No change in which note rolls into which for a vault that works today: `e2e/baseline.e2e.js` and the rest of the e2e suite pass unchanged. Never regenerate `e2e/fixtures/expected/`.
- Work on a branch, not `main`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A folder setting typed as `/daily/` or ` daily ` should behave like `daily` (Task 1: `cleanFolder` cases, plus `getDailyNoteSettings` returning the cleaned folder).
2. A fresh vault where Daily Notes has never been configured (`instance.options` is `{}` or missing) should use `YYYY-MM-DD` at the vault root, where notes like `Inbox.md` are not daily notes (Task 1: settings defaults test, root-folder `noteDate` test).
3. Periodic Notes users, whose settings the e2e vault cannot exercise, should get Periodic Notes' folder and format (Task 1: fake-app settings tests).
4. Formats with literal text or words (`[Journal] YYYY-MM-DD`, `dddd, MMMM D, YYYY`) should still be recognised (Task 1: `noteDate` cases).
5. Notes created ahead of time for future days should never be picked as the previous note (Task 1: `previousDailyNote` test).

---

### Task 0: Branch

- [ ] **Step 1:** `git switch -c own-daily-notes-lookup`, then commit the spec and this plan:

```bash
git add docs/superpowers/specs/2026-11-20-own-daily-notes-lookup-design.md docs/superpowers/plans/2026-11-20-own-daily-notes-lookup.md
git commit -m "Add the design and plan for owning the daily-notes lookup"
```

### Task 1: `src/daily-notes.js` with unit tests

**Files:**

- Create: `src/daily-notes.js`
- Create: `src/daily-notes.test.js`
- Modify: `package.json` (add dev dependency `"moment": "2.31.0"`), `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**

- Produces (all named exports of `src/daily-notes.js`):
  - `DEFAULT_DAILY_NOTE_FORMAT = "YYYY-MM-DD"`
  - `cleanFolder(folder: string | undefined) → string`: trimmed, leading and trailing `/` removed, `""` for root or missing.
  - `noteDate(path: string, { folder, format }, moment) → Moment | null`
  - `todayNotePath({ folder, format }, today: Moment) → string`
  - `dailyNotes(files: { path }[], settings, moment) → { file, date }[]`, newest first.
  - `previousDailyNote(files, settings, today: Moment, moment) → file | null`: newest note dated before `today`'s day.
  - `getDailyNoteSettings(app) → { folder, format, template } | null` (`folder` already through `cleanFolder`; `null` when reading throws).
  - `isDailyNotesEnabled(app) → boolean`: the body of `index.js`'s `isDailyNotesEnabled()` with `this.app` → `app`, coerced to a boolean.

`settings` everywhere means `{ folder, format }` as `getDailyNoteSettings()` returns it (folder already clean).

- [ ] **Step 1: Add moment for the tests**

Run: `pnpm add -D moment@2.31.0`
Expected: `package.json` lists `"moment": "2.31.0"` under `devDependencies`.

- [ ] **Step 2: Write the failing tests** in `src/daily-notes.test.js` (`import moment from "moment"`). Use `const S = { folder: "daily", format: "YYYY-MM-DD" }` and `const d = (s) => moment(s, "YYYY-MM-DD", true)`. Compare dates with `.format("YYYY-MM-DD")`.

```js
describe("cleanFolder", () => {
  test.each([
    ["daily", "daily"], ["/daily", "daily"], ["daily/", "daily"],
    ["/daily/", "daily"], ["  daily  ", "daily"], ["a/b/", "a/b"],
    ["", ""], ["/", ""], [undefined, ""],
  ])("%j → %j", (input, out) => expect(cleanFolder(input)).toBe(out));
});

describe("noteDate", () => {
  const date = (path, s = S) => noteDate(path, s, moment)?.format("YYYY-MM-DD") ?? null;
  test("a note in the folder", () => expect(date("daily/2026-11-19.md")).toBe("2026-11-19"));
  test("a sibling folder sharing the prefix", () => expect(date("daily-old/2026-11-19.md")).toBeNull());
  test("a subfolder the format does not describe", () => expect(date("daily/archive/2026-11-19.md")).toBeNull());
  test("outside the folder", () => expect(date("2026-11-19.md")).toBeNull());
  test("not markdown", () => expect(date("daily/2026-11-19.pdf")).toBeNull());
  test("strict parsing", () => expect(date("daily/2026-11-5.md")).toBeNull());
  test("not a date", () => expect(date("daily/Ideas.md")).toBeNull());
  test("a folder with regex characters", () =>
    expect(date("Daily (work)/2026-11-19.md", { folder: "Daily (work)", format: "YYYY-MM-DD" })).toBe("2026-11-19"));
  test("the vault root", () => {
    const root = { folder: "", format: "YYYY-MM-DD" };
    expect(date("2026-11-19.md", root)).toBe("2026-11-19");
    expect(date("Inbox.md", root)).toBeNull();
    expect(date("daily/2026-11-19.md", root)).toBeNull();
  });
  test("a format with folders in it", () => {
    const nested = { folder: "journal", format: "YYYY/MM/YYYY-MM-DD" };
    expect(date("journal/2026/10/2026-10-31.md", nested)).toBe("2026-10-31");
    expect(date("journal/2026-10-31.md", nested)).toBeNull();
  });
  test("literal text and words in the format", () => {
    expect(date("daily/Journal 2026-11-19.md", { folder: "daily", format: "[Journal] YYYY-MM-DD" })).toBe("2026-11-19");
    expect(date("daily/Thursday, November 19, 2026.md", { folder: "daily", format: "dddd, MMMM D, YYYY" })).toBe("2026-11-19");
  });
});

describe("todayNotePath", () => {
  test("in a folder", () => expect(todayNotePath(S, d("2026-11-20"))).toBe("daily/2026-11-20.md"));
  test("at the root", () => expect(todayNotePath({ folder: "", format: "YYYY-MM-DD" }, d("2026-11-20"))).toBe("2026-11-20.md"));
  test("a format with folders in it", () =>
    expect(todayNotePath({ folder: "journal", format: "YYYY/MM/YYYY-MM-DD" }, d("2026-11-20"))).toBe("journal/2026/11/2026-11-20.md"));
});

describe("dailyNotes", () => {
  test("only daily notes, newest first", () => {
    const files = ["daily/2026-11-18.md", "daily/Ideas.md", "daily/2026-11-20.md", "Inbox.md", "daily/2026-11-19.md"].map((path) => ({ path }));
    expect(dailyNotes(files, S, moment).map((n) => n.file.path)).toEqual(["daily/2026-11-20.md", "daily/2026-11-19.md", "daily/2026-11-18.md"]);
  });
});

describe("previousDailyNote", () => {
  const prev = (paths, today = "2026-11-20") =>
    previousDailyNote(paths.map((path) => ({ path })), S, d(today), moment)?.path ?? null;
  test("the newest before today", () => expect(prev(["daily/2026-11-17.md", "daily/2026-11-20.md", "daily/2026-11-19.md"])).toBe("daily/2026-11-19.md"));
  test("skips future-dated notes", () => expect(prev(["daily/2026-11-21.md", "daily/2026-11-20.md", "daily/2026-11-18.md"])).toBe("daily/2026-11-18.md"));
  test("only today's note", () => expect(prev(["daily/2026-11-20.md"])).toBeNull());
  test("a gap of several days", () => expect(prev(["daily/2026-11-02.md", "daily/2026-11-20.md"])).toBe("daily/2026-11-02.md"));
  test("without today's note", () => expect(prev(["daily/2026-11-19.md"])).toBe("daily/2026-11-19.md"));
});

describe("getDailyNoteSettings", () => {
  const app = ({ daily, periodic } = {}) => ({
    plugins: { getPlugin: (id) => (id === "periodic-notes" ? periodic : undefined) },
    internalPlugins: { getPluginById: (id) => (id === "daily-notes" ? daily : undefined) },
  });
  test("Daily Notes options, cleaned", () =>
    expect(getDailyNoteSettings(app({ daily: { instance: { options: { folder: " /daily/ ", format: "YYYY.MM.DD", template: " t/daily " } } } })))
      .toEqual({ folder: "daily", format: "YYYY.MM.DD", template: "t/daily" }));
  test("never configured", () => {
    const fresh = { folder: "", format: "YYYY-MM-DD", template: "" };
    expect(getDailyNoteSettings(app({ daily: { instance: { options: {} } } }))).toEqual(fresh);
    expect(getDailyNoteSettings(app())).toEqual(fresh);
  });
  test("Periodic Notes with daily notes on wins", () =>
    expect(getDailyNoteSettings(app({
      daily: { instance: { options: { folder: "daily" } } },
      periodic: { settings: { daily: { enabled: true, folder: "journal", format: "YYYY/MM/DD" } } },
    }))).toEqual({ folder: "journal", format: "YYYY/MM/DD", template: "" }));
  test("Periodic Notes with daily notes off is ignored", () =>
    expect(getDailyNoteSettings(app({
      daily: { instance: { options: { folder: "daily" } } },
      periodic: { settings: { daily: { enabled: false, folder: "journal" } } },
    })).folder).toBe("daily"));
  test("null when reading throws", () =>
    expect(getDailyNoteSettings({ plugins: { getPlugin: () => { throw new Error("boom"); } } })).toBeNull());
});

describe("isDailyNotesEnabled", () => {
  test.each([
    [{ enabled: true }, undefined, true],
    [{ enabled: false }, undefined, false],
    [undefined, { settings: { daily: { enabled: true } } }, true],
    [undefined, undefined, false],
  ])("daily-notes %j, periodic %j → %j", (daily, periodic, out) =>
    expect(isDailyNotesEnabled({
      internalPlugins: { plugins: { "daily-notes": daily } },
      plugins: { getPlugin: () => periodic },
    })).toBe(out));
});
```

`getDailyNoteSettings` swallows the error with `console.info("Daily Catch-Up: could not read the daily notes settings", err)`. Spy on `console.info` in that test so the output stays quiet.

- [ ] **Step 3: Run the tests to make sure they fail**

Run: `pnpm test -- src/daily-notes.test.js --run`
Expected: FAIL, cannot resolve `./daily-notes`.

- [ ] **Step 4: Implement the exports listed under Interfaces in `src/daily-notes.js`**

`noteDate`: with a folder, require `path.startsWith(folder + "/")` and strip it. Require `.endsWith(".md")` and strip it. Return `moment(rest, format, true)` when `.isValid()`, else `null`. `todayNotePath`: `today.format(format) + ".md"`, prefixed by `folder + "/"` when the folder is non-empty. `previousDailyNote`: the first entry of `dailyNotes()` whose `date.isBefore(today, "day")`. `getDailyNoteSettings`: the library's logic (quoted in the spec's Intent) with `window.app` → `app`, plus `cleanFolder` on the folder.

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `pnpm test -- --run`
Expected: every test file passes, including `src/daily-notes.test.js`.

- [ ] **Step 6: Commit**

```bash
git add src/daily-notes.js src/daily-notes.test.js package.json pnpm-lock.yaml
git commit -m "Add the plugin's own daily-notes lookup"
```

### Task 2: Switch the callers, drop the library, e2e tests

**Files:**

- Create: `e2e/daily-notes.e2e.js`
- Modify: `src/index.js` (imports lines 1-6; `isDailyNotesEnabled` ~90-99; `getLastDailyNote` ~101-139; `getFileMoment` ~141-154; `getCleanFolder` ~165-177; `rollover()` ~248-300)
- Modify: `src/ui/RolloverSettingTab.js:15,40`
- Modify: `package.json`, `pnpm-lock.yaml`, `CLAUDE.md`, `docs/roadmap.md`

**Interfaces:**

- Consumes: from Task 1, `getDailyNoteSettings(app)`, `isDailyNotesEnabled(app)`, `todayNotePath(settings, today)`, `previousDailyNote(files, settings, today, moment)`.
- Produces: `RolloverTodosPlugin.getLastDailyNote()` keeps its name and returns a `TFile` or `null` (it returned `undefined` before; every caller tests truthiness). `isDailyNotesEnabled()`, `getFileMoment()` and `getCleanFolder()` leave the class. Grep `src/` and `e2e/` for each before deleting it.

- [ ] **Step 1: Write the e2e tests** in `e2e/daily-notes.e2e.js`. Use `afterEach(expectNoErrors)` and an `afterEach` that puts back the bootstrap options. A helper `setDailyOptions(options)` assigns `app.internalPlugins.plugins["daily-notes"].instance.options` through `evalJs`, as `bootstrap()` does in `e2e/helpers/vault.js:151-163`, and the restore uses `{ folder: "daily", format: "YYYY-MM-DD", template: "templates/daily" }`. Write the notes with `reset()` before setting the options, and include today's note in them, so that each run goes through the command (`runCommand("rollover")`, then `waitForNotice("rolled over")` and `waitForIdle()`).

  - `test("a daily folder with brackets in its name")`: options `{ folder: "Daily (work)", format: "YYYY-MM-DD", template: "templates/daily" }`. Notes: `templates/daily.md` and today's `Daily (work)/<day()>.md` from `fixture("daily-template.md")`, and `Daily (work)/<day(-1)>.md` from `fixture("previous.md")`. Expect today's note to contain `- [ ] Ship release`.
  - `test("a format with folders in it, across a month boundary")`: options `{ folder: "journal", format: "YYYY/MM/YYYY-MM-DD", template: "templates/daily" }`. Previous note `journal/<YYYY>/<MM>/<date>.md`, dated the last day of the previous month. Today's note `journal/<YYYY>/<MM>/<day()>.md`. Compute both paths in the test from `new Date()`. Expect today's note to contain `- [ ] Ship release`.
  - `test("the command with a daily folder that does not exist")`: options `{ folder: "missing", … }`, notes from `standardNotes()`. Run `await ${plugin}.rollover()` through `startAsync()` / `awaitAsync()`, so the test waits for the run to end: today it rejects with `DailyNotesFolderMissingError`. Expect `awaitAsync()` to resolve, and every note to read back unchanged (`snapshotNotes()` before and after).

- [ ] **Step 2: Run the new e2e file to see the current code fail**

Run: `pnpm test:e2e e2e/daily-notes.e2e.js` (Obsidian open with `e2e-vault`)
Expected: "brackets" and "does not exist" FAIL. "folders in it" may already pass, since it guards behaviour that works today.

- [ ] **Step 3: Switch the callers**

  - `rollover()`: settings from `getDailyNoteSettings(this.app)`; keep the `null` branch (console warning, plus a notice on command runs). A command run looks up `this.app.vault.getAbstractFileByPath(todayNotePath(settings, window.moment()))` and continues only with a `TFile`. Replace the folder and constructed-path checks with `file.path === todayNotePath(settings, window.moment())`. The creation-time check and everything after stay as they are.
  - `getLastDailyNote()`: read the settings, return `null` without them, else `previousDailyNote(this.app.vault.getMarkdownFiles(), settings, window.moment(), window.moment)`.
  - `rolloverDailyNote()`: `isDailyNotesEnabled(this.app)`.
  - `RolloverSettingTab.getTemplateHeadings()`: `getDailyNoteSettings(this.app) ?? {}`.

- [ ] **Step 4: Drop the library and pin obsidian**

Run: `pnpm remove obsidian-daily-notes-interface && pnpm add -D obsidian@1.14.4`
Expected: `package.json` has no `dependencies` entry for the library, and `"obsidian": "1.14.4"`. `grep -rn daily-notes-interface src` prints nothing.

- [ ] **Step 5: Build and unit test**

Run: `pnpm build && pnpm test -- --run`
Expected: build succeeds, every unit test passes, and `grep -c "function isMoment" main.js` prints `0` (moment is not bundled).

- [ ] **Step 6: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: every file passes, `baseline.e2e.js` included, with the three new tests.

- [ ] **Step 7: Flakiness check on the new file**

Run `pnpm test:e2e e2e/daily-notes.e2e.js` twice more. Every run must pass.

- [ ] **Step 8: Docs**

  - `CLAUDE.md`: under core files, add `src/daily-notes.js` after `src/note-paths.js`: the pure lookup (`cleanFolder`, `noteDate` (strict match of the path inside the folder against the full format), `todayNotePath`, `dailyNotes`, `previousDailyNote`) and the settings readers (`getDailyNoteSettings(app)` (Daily Notes, or Periodic Notes' `daily` when enabled), `isDailyNotesEnabled(app)`), with `moment` and `app` passed in. In the rollover flow, `getLastDailyNote()` becomes "`getLastDailyNote()` (`previousDailyNote()`: the newest daily note dated before today)". Add `src/daily-notes.test.js` to the unit-test list, and `e2e/daily-notes.e2e.js` (a daily folder with brackets, a format with folders across a month boundary, a missing daily folder) to the e2e test list.
  - `docs/roadmap.md`: tick `- [ ] Own the daily-notes lookup`, and in item 3 drop "Until then, at least bump to 0.9.5."

- [ ] **Step 9: Commit**

```bash
git add src/index.js src/ui/RolloverSettingTab.js e2e/daily-notes.e2e.js package.json pnpm-lock.yaml CLAUDE.md docs/roadmap.md
git commit -m "Use the plugin's own daily-notes lookup and drop obsidian-daily-notes-interface"
```
