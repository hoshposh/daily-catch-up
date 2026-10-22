# Rollover Daily Todos

[![Build](https://github.com/hoshposh/obsidian-rollover-daily-todos/actions/workflows/ci.yml/badge.svg)](https://github.com/hoshposh/obsidian-rollover-daily-todos/actions/workflows/ci.yml)

> This is a personal fork of [lumoe/obsidian-rollover-daily-todos](https://github.com/lumoe/obsidian-rollover-daily-todos).

This Obsidian plugin will rollover any incomplete todo items from the previous daily note (could be yesterday, or a week ago) to today. This is triggered automatically when a new daily note is created via the internal `Daily notes` plugin, or the `Periodic Notes` plugin., It can also be run as a command from the Command Palette.

![A demo of the plugin working](./demo.gif)

## Usage

### 1. New Daily Note

Just create a new daily note using the `Daily notes` or `Periodic Notes` plugin. The previous day's incomplete todos will be rolled over to today's daily note.

**Note:** Automatic rollover can conflict with other plugins that rewrite new notes, particularly Templater. If Templater is enabled and **#4** is set to mark or delete, the plugin waits 3 seconds after adding the todos and checks that they are still in today's note before changing the previous day's note (see Bugs/Issues).

### 2. Command: Manual Rollover Todos Now

You can also open your command palette (CMD+P on macOS) and start typing `roll` to find this command. No matter where you are in Obsidian, the previous day's todos will get rolled forward.

**Note:** The standard undo command (CMD+Z on macOS) does not work for rollover operations. Use the dedicated `Undo last rollover` command instead (see below).

### 3. Command: Undo Last Rollover

Run `Undo last rollover` from the command palette within **2 minutes** of a rollover to fully reverse it. Only the most recent rollover can be undone.

The undo works by restoring complete snapshots of both files — today's note and the previous day's note — to their exact state before the rollover ran. This means:

- All inserted todos and headings are removed from today's note
- If **Delete todos from previous day** is enabled, any todos and headings removed from the previous note are restored
- The restoration is complete regardless of how many todos or sub-headings were involved

If the Templater plugin is enabled, `Undo last rollover` only restores the previous day's note and leaves today's note as it is, because Templater rewrites a new note after the todos are added and restoring an earlier version would replace its output. Remove the rolled over todos from today's note yourself in that case. If the rollover did not change the previous day's note, there is nothing to undo.

Note that if you create a daily note in the future, and you try to run this command, todos will not be rolled into a future date. They will always be rolled to today's note (if it doesn't exist, nothing will happen), from the chronologically closest (in the past) daily note.

## Requirements

- [ ] Obsidian 1.1.0 or newer.
- [ ] You must have either:
  1. `Daily notes` plugin installed _or_
  2. `Periodic Notes` plugin installed AND the **Daily Notes** setting toggled on
- [ ] A Note folder set in one of these plugins. Inside it you must have:
  1. 2 or more notes
  2. All notes must be named in the format you use for daily notes (for example `2021-08-29` for `YYYY-MM-DD` )

## Settings

### 1. Disable automatic rollover

If you prefer to trigger the rollover of your todos manually, you can use this setting to prevent the plugin from rolling them over when a new note is created.

### 2. Template Heading

If you chose a template file to use for new daily notes in `Daily notes > Settings` or `Periodic Notes > Settings`, you will be able to choose a heading for incomplete notes to roll into. Note that incomplete todos are taken from the entire file, regardless of what heading they are under. And they are all rolled into today's daily note, right under the heading of choice.

If you leave this field as blank, or select `None`, then incomplete todos will be rolled onto the end of today's note (for new notes with no template, the end is the beginning of the note).

If the plugin cannot read headings from your template (the template is missing or unreadable, or has no headings), the dropdown is replaced by a text field where you can type the exact heading, e.g. `## Tasks`, or `none`.

### 4. After rollover, on the previous day's note

By default, this plugin makes a copy of incomplete todos. So if you forgot to wash your dog yesterday, and didn't check it off, then you will have an incomplete checkmark on yesterday's daily note, and a new incomplete checkmark will be rolled into today's daily note. You can choose what happens to the rolled todos on yesterday's note once today's note has a copy of them:

- **Leave them alone** (default): yesterday's note is unchanged.
- **Mark them**: the rolled todos get a different checkbox character, so `- [ ] wash the dog` becomes `- [>] wash the dog`. The character is configurable (default `>`, the bullet-journal "forwarded" symbol). Only open todos are marked, including open children; completed children and plain text are left as they are. While this option is selected the marker also counts as a done marker (without changing your **#7** setting), so marked todos are not rolled over again.
- **Delete them**: the rolled todos are removed from yesterday's note. This is destructive. Headings left empty by this are removed too.

If you use the `Undo last rollover` command, marked or deleted todos will be restored (remember, the time limit on this is 2 minutes). If you previously had **Delete todos from previous day** turned on, your setting is carried over as **Delete them**.

### 5. Remove empty todos in rollover

By default, this plugin will roll over anything that has a checkbox, whether it has content or not. Toggling this setting on will ignore empty todos. If **#4** is set to delete, it will also delete empty todos.

### 6. Roll over children of todos

By default, only the actual todos are rolled over. If you add nested Markdown elements beneath your todos, these are not rolled over but stay in place. Toggling this setting on allows for also migrating the nested elements, including ones that are completed.

### 7. Done status markers

By default, the plugin considers checkboxes containing 'x', 'X', or '-' as completed tasks that won't be rolled over. You can customize this by adding any characters that should be considered "done" markers. For example, adding '?+>' would also treat checkboxes like '[?]', '[+]', and '[>]' as completed tasks. This is useful for users of custom status markers like the [Obsidian Tasks](https://publish.obsidian.md/tasks/Introduction) plugin.

The plugin supports Unicode characters, including complex emoji and grapheme clusters, in checkbox content. This means you can use emojis or special Unicode characters as status markers and they will be handled correctly.

### 8. Skip completed children

Only applies when **#6** is on. Completed nested todos (using the done status markers from **#7**), and everything nested beneath them, are not rolled over. A completed item that still has an open todo somewhere beneath it is rolled over with it, so open work is never left behind. If **#4** is set to delete, they are removed from the previous note together with their rolled parent, so no orphaned child lines are left behind. Use `Undo last rollover` to bring them back.

### 9. Ignore todos in callouts and blockquotes

Todos inside Markdown blockquotes (lines starting with `>`), such as habit lists kept in a `> [!tip]` callout, are not rolled over. Off by default.

### 10. Skip todos already in today's note

Off by default. When on, a todo is not rolled over if today's note already contains the same line (compared ignoring surrounding whitespace, checkbox included). This is useful when your daily template already contains recurring tasks such as `- [ ] Standup`. With **#6** on, a duplicate is skipped together with its nested items only if all of them are already in today's note too; otherwise the whole group is rolled over so that nothing is lost. A nested item that matches while its parent does not is still rolled over. Skipped todos still count as handled for **#4**: they are marked or deleted on the previous day's note, so they don't pile up there.

**Which lines count as todos:** a todo is a list item (`-`, `*` or `+`) with a checkbox at the start of the line, optionally indented or inside a blockquote. Lines where something else comes before the bullet, such as `1. - [ ] task` or text inside a code block, are not treated as todos.

## Bugs/Issues

1. Sometimes you will use this plugin, and your unfinished todos will stay in the same spot. These could be formatting issues.

- Regex is used to search for unfinished todos: `/\s*[-*+] \[[^xX-]\].*/g` (or with your custom done markers)
- At a minimum, they need to look like: `start of line | tabs`-` `[` `]`Your text goes here`
- If you use spaces instead of tabs at the start of the line, the behavior of the plugin can be inconsistent. Sometimes it'll roll items over, but not delete them from the previous day when you have that option toggled on.

1. Sometimes, if you trigger the `rollover` function too quickly, it will read the state of a file before the new data was saved to disk. For example, if you add a new incomplete todo to yesterday's daily note, and then quickly run the `Rollover Todos Now` command, it may grab the state of the file a second or two before you ran the command. If this happens, just run the `Undo last rollover` command. Wait a second or two, then try rolling over todos again.

For example (no template heading, empty todos toggled on):

```markdown
You type in:

- [x] Do the dishes
- [ ] Take out the trash

And then you run the Rollover Todos Now command. Today's daily note might look like:

- [ ] Take out the trash

And the previous day might look like

- [x] Do the dishes
```

1. There are sometimes conflicts with other plugins that deal with new notes -- particularly the Templater plugin, which rewrites a new note shortly after it is created and can overwrite the rolled todos. When Templater is enabled and **#4** is set to mark or delete, the plugin waits 3 seconds, checks that the rolled todos are still in today's note, and otherwise leaves the previous day's note unchanged and shows a notice; run `Rollover Todos Now` to try again. This is a safety net, not a fix: a template slower than 3 seconds (for example one that calls the web) can still overwrite the todos after the check, and plugins other than Templater are not covered. If that affects you, disable the automatic rollover and trigger it manually after the note is created.

## Installation

This plugin can be installed within the `Third-party Plugins` tab within Obsidian

## Development

### Releasing a new version for BRAT testing

[BRAT](https://github.com/TfTHacker/obsidian42-brat) (Beta Reviewers Auto-update Tool) installs plugins directly from GitHub releases. To publish a testable build:

1. **Bump the version** in `manifest.json` and `package.json` to the new version (e.g. `1.3.0`).

2. **Build** the plugin:

   ```bash
   pnpm build
   ```

3. **Commit** the version bump (`main.js` is git-ignored; it is attached to the release in the next step):

   ```bash
   git add manifest.json package.json
   git commit -m "Release 1.3.0"
   git push
   ```

4. **Create a GitHub release** with `main.js` and `manifest.json` attached as assets. Both files are required — BRAT uses `manifest.json` to read the version and `main.js` as the plugin bundle:

   ```bash
   gh release create 1.3.0 main.js manifest.json --title "1.3.0" --notes "Release notes here"
   ```

5. **Install via BRAT** in Obsidian: open BRAT settings → _Add Beta Plugin_ → enter `hoshposh/obsidian-rollover-daily-todos`. BRAT will pull the latest release automatically.
