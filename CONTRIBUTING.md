# Contributing

Daily Catch-Up started as a fork of [lumoe/obsidian-rollover-daily-todos](https://github.com/lumoe/obsidian-rollover-daily-todos). Changes are welcome as issues and pull requests on [hoshposh/daily-catch-up](https://github.com/hoshposh/daily-catch-up).

## Setup

The repository pins pnpm 8.15.9 in `mise.toml`.

```bash
pnpm install
pnpm dev                    # rebuild main.js on every change
pnpm build                  # production build -> main.js
pnpm test -- --run          # run the unit tests once (plain `pnpm test` watches)
pnpm test -- -t "some name" # run tests whose name matches
pnpm test:e2e               # end-to-end tests in Obsidian (see "Testing in Obsidian")
pnpm demo readme            # record the README demo (see "Recording demos")
```

`pnpm format` runs Prettier over the whole repository. Some existing files are not Prettier-clean, so it creates noisy diffs; format the files you create instead (`npx prettier --write <file>`).

## Where the code lives

Keep logic in the pure modules, which have unit tests and no dependency on Obsidian. `src/index.js` and `src/ui/` need Obsidian to run and have no tests, so they should stay thin.

| File                       | Responsibility                                                        |
| -------------------------- | --------------------------------------------------------------------- |
| `src/get-todos.js`         | Todo parser, `getSections()`, heading helpers, `insertUnderHeading()` |
| `src/source-action.js`     | What happens to the previous day's note: `none` / `delete` / `mark`   |
| `src/insert-sections.js`   | Placing yesterday's sections of todos into today's note               |
| `src/insert-todos.js`      | Skip-existing and the Templater safeguard checks                      |
| `src/template-headings.js` | Template heading setting helpers                                      |
| `src/index.js`             | Plugin lifecycle and the `rollover()` flow                            |
| `src/ui/`                  | Settings tab and undo dialog                                          |

See `CLAUDE.md` for the settings and the rollover flow in more detail.

## Testing in Obsidian

The unit tests cannot cover `rollover()`, the dialogs or the settings tab. The end-to-end tests do, by driving the real Obsidian app.

### Automated tests

`pnpm test:e2e` runs the end-to-end tests (`e2e/*.e2e.js`) in the running Obsidian app, through the official Obsidian CLI (Obsidian 1.12 or later, with the CLI turned on).

1. Once: create an **empty** vault named `e2e-vault` and open it in Obsidian. The suite adopts it by writing a `.e2e-vault` marker file, and from then on deletes and rewrites its notes on every run. It refuses any other vault, and an unmarked vault that already has notes.
2. Keep Obsidian running with `e2e-vault` open, then run `pnpm test:e2e` (or `pnpm test:e2e e2e/guards.e2e.js` for one file).
3. Don't use that Obsidian window while the tests run: they open dialogs, press keys and change the theme in it.

Each run builds the plugin straight into the vault's `.obsidian/plugins/daily-catch-up/` (a real folder, not a symlink) and never touches the repo's own `main.js` or `data.json`. Tests that check a layout save screenshots in `e2e/screenshots/`, and the run lists them at the end for you to look at.

### Recording demos

`demo.gif` in the README is recorded from a script, `e2e/demos/readme.demo.js`, so it can be re-recorded when the UI changes. The script drives Obsidian with the end-to-end helpers while a recorder inside Obsidian captures the window. It shows a fake pointer and highlights, since screen captures don't include the mouse.

1. Install ffmpeg. gifsicle is optional but makes the GIF noticeably smaller.
2. With Obsidian running and `e2e-vault` open, as for the end-to-end tests, run `pnpm demo readme`. It prints the GIF's path, length and size: `e2e/demos/out/readme.gif`.
3. Watch it. Only when it looks right, copy it over `demo.gif` and commit that. The GIF must stay under 2 MB; the run warns when it is over.

Obsidian draws nothing while its window is hidden behind other windows, except while the recorder runs, so a recording works in the background. The recording resizes the window and collapses its side panels, and puts both back afterwards.

`e2e/demos/out/` and `e2e/demos/private/` (for throwaway clips) are not committed.

### Exploring by hand

To try a change yourself, use a throwaway vault: Delete and Mark rewrite the previous day's note.

#### 1. Set up a test vault

1. Create a new vault, for example `rollover-test`.
2. Turn on **Core plugins > Daily notes** and keep the default folder and date format.
3. Disable the original `obsidian-rollover-daily-todos` plugin in that vault if it is installed. This plugin uses the id `daily-catch-up`, so both can be installed, but you would get a double rollover.

#### 2. Install your build

The folder name must match the manifest id.

**Symlink with watch mode (best while iterating):**

```bash
mkdir -p <vault>/.obsidian/plugins
ln -s "$(pwd)" <vault>/.obsidian/plugins/daily-catch-up
pnpm dev
```

Then enable _Daily Catch-Up_ under **Settings > Community plugins** (turn Restricted mode off first). After a rebuild, run **Reload app without saving** from the command palette, or toggle the plugin off and on. The plugin's `data.json` is created inside the repository and is git-ignored.

**Copy the files:**

```bash
pnpm build
mkdir -p <vault>/.obsidian/plugins/daily-catch-up
cp main.js manifest.json styles.css <vault>/.obsidian/plugins/daily-catch-up/
```

Repeat the copy after each change.

#### 3. Create the notes

Create yesterday's note, named with yesterday's date (for example `2026-10-21.md`):

```markdown
## Work

- [ ] Ship release
  - [x] Write changelog
  - [ ] Tag version
  - remember to bump manifest
- [x] Fix flaky test
- [ ]

## Home

- [ ] Laundry
```

Add a few lines for the edge cases: a `> [!tip]` callout containing `> - [ ] habit`, and a `- notes` line under two different parents.

Let Obsidian create today's note (the **Open today's daily note** command), so the rollover runs on creation. To repeat a test, delete today's note and create it again. You can also run **Roll over todos now** on an empty today's note; it ignores the 5-second creation window.

#### 4. What to check

| Setting                                      | What to look for                                                                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source action: Leave them alone              | Today's note gets the todos under their headings; yesterday's note is unchanged.                                                                                                        |
| Source action: Mark them (`>`)               | Rolled todos on yesterday's note become `[>]`. Completed children and plain text stay as they are. Running the rollover again does not roll them twice.                                 |
| Source action: Delete them                   | Rolled lines disappear from yesterday's note, and headings that this empties go too (but not ones that were already empty). An identical `- notes` line under a different parent stays. |
| Undo last rollover                           | Within 2 minutes it restores yesterday's note, and today's note too unless Templater is enabled.                                                                                        |
| Roll over children + Skip completed children | `Write changelog` is not rolled. With Delete it is removed from yesterday together with its parent.                                                                                     |
| Skip todos already in today's note           | Put `- [ ] Laundry` in the daily template. It is not inserted twice and the notice mentions the skip.                                                                                   |
| Ignore todos in callouts                     | The `> - [ ] habit` line stays where it is.                                                                                                                                             |
| Template heading                             | Set one in the daily template. Try a heading that is not in today's note and expect the "couldn't find" notice.                                                                         |
| Broken template path                         | Point the Daily notes template at a file that does not exist. The settings page must still open, with a text field for the heading.                                                     |

If you use Templater, also try a daily template with Templater syntax together with Delete or Mark. After about 3 seconds either yesterday's note changes, or you see the "modified by another plugin" notice.

#### 5. Debugging

Open the developer console with `Ctrl+Shift+I` (`Cmd+Option+I` on macOS) and look for red errors and for lines starting with `Daily Catch-Up:`.

## Branches and upstream

- `main` is this fork's primary branch.
- `master` tracks upstream's `master`. Upstream changes are cherry-picked onto `main` one at a time instead of merged in bulk.
- `release/v1.3.0` is an upstream work-in-progress branch. Its outcome is recorded in [`docs/upstream-v1.3.0-triage.md`](docs/upstream-v1.3.0-triage.md); do not merge it wholesale.

Commit messages are short imperative sentences ("Add mark-as-moved source action ..."), with the reasoning in the body when it is not obvious.

## Releasing

See _Development > Releasing a new version_ in the [README](README.md).
