# Rollover Daily Todos

[![Build](https://github.com/hoshposh/obsidian-rollover-daily-todos/actions/workflows/ci.yml/badge.svg)](https://github.com/hoshposh/obsidian-rollover-daily-todos/actions/workflows/ci.yml)

This Obsidian plugin will rollover any incomplete todo items from the previous daily note (could be yesterday, or a week ago) to today. This is triggered automatically when a new daily note is created via the internal `Daily notes` plugin, or the `Periodic Notes` plugin. It can also be run as a command from the Command Palette.

![A demo of the plugin working](./demo.gif)

Beyond the basic rollover, this plugin:

- groups todos by their headings and recreates those headings in today's note;
- lets you review what is about to move and choose an outcome for each todo: roll it, send it to a backlog note, cancel it, or leave it;
- can count how often a todo has been rolled over, so you notice the ones that never get done.

## Origins and status

This plugin started as a fork of [Rollover Daily Todos](https://github.com/lumoe/obsidian-rollover-daily-todos), created by Matthew Sessions and maintained by Lukas Mölschl. Thank you to both, and to everyone who contributed to it.

It is being prepared as a separate community plugin under a new name. Its own additions are:

- the heading-aware rollover;
- the review dialog;
- rollover counting and stale todos;
- the backlog note.

Several options were adapted from upstream's unreleased `release/v1.3.0` branch:

- marking rolled todos as moved;
- skipping todos already in today's note;
- the Templater safeguard;
- ignoring todos in callouts and blockquotes;
- skipping completed children.

Until it is listed in Obsidian's community plugins, install it with BRAT or manually (see [Installation](#installation)).

## Usage

### 1. New Daily Note

Just create a new daily note using the `Daily notes` or `Periodic Notes` plugin. The previous day's incomplete todos will be rolled over to today's daily note.

**Note:** Automatic rollover can conflict with other plugins that rewrite new notes, particularly Templater. If Templater is enabled and **After rollover** is set to mark or delete, the plugin waits 3 seconds after adding the todos and checks that they are still in today's note before changing the previous day's note (see Bugs/Issues).

### 2. Command: Manual Rollover Todos Now

You can also open your command palette (CMD+P on macOS) and start typing `roll` to find this command. No matter where you are in Obsidian, the previous day's todos will get rolled forward.

**Note:** The standard undo command (CMD+Z on macOS) does not work for rollover operations. Use the dedicated `Undo last rollover` command instead (see below).

### 3. Command: Review and Roll Over Todos…

Run `Review and roll over todos…` to see the todos that are about to move before anything happens. A dialog lists them under the headings they sit in, and you pick an outcome for each one:

| Outcome     | Today's note                                                      | Previous day's note                                                                                             |
| ----------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Roll**    | The todo is added (counter raised when **Count rollovers** is on) | Handled as set in **After rollover**                                                                            |
| **Backlog** | Not added                                                         | Handled as set in **After rollover**, as if it had been rolled                                                  |
| **Cancel**  | Not added                                                         | The checkbox is set to the **Cancel marker**, even if **After rollover** is **Leave them alone**; never deleted |
| **Leave**   | Not added                                                         | Not changed                                                                                                     |

Every todo defaults to **Roll**. **All roll** and **All leave** buttons set a whole section, or all todos, at once, and a summary line counts the outcomes as you go. A todo moves together with its nested items as one unit: a nested empty todo left out by **Remove empty todos**, or a completed one left out by **Skip completed children**, belongs to the todo it is indented under, so it stays when that todo is cancelled or left. **Backlog** is only offered when a **Backlog note** is set, and **Cancel** only when the **Cancel marker** is one of your **Done status markers**. Todos that have rolled over too often show a "rolled 5×" badge (see **Aging** below).

**Apply** carries out the choices. Closing the dialog any other way (**Cancel** button, Escape, clicking outside) abandons the rollover and changes nothing. The dialog only opens when there is something to roll; otherwise it behaves like `Rollover Todos Now`. `Rollover Todos Now` never asks, and automatic rollovers only ask if you set **Review automatic rollovers**. While a rollover is running, for example with the dialog open, no second one starts: running a command then says a rollover is already in progress.

Todos sent to the backlog are added to the **Backlog note** with their nested items, without their rollover counter, and with a link back to where they came from:

```markdown
- [ ] Write the quarterly report [from:: [[2026-11-02]]]
```

### 4. Command: Undo Last Rollover

Run `Undo last rollover` from the command palette within **2 minutes** of a rollover to fully reverse it. Only the most recent rollover can be undone.

The undo works by restoring complete snapshots of the files the rollover changed — today's note, the previous day's note and the backlog note — to their exact state before the rollover ran. This means:

- All inserted todos and headings are removed from today's note
- If **After rollover** changed the previous note (**Mark them** or **Delete them**), the marked or deleted todos, and any headings removed with them, are restored
- If the rollover added to the backlog note, those todos are removed again; a backlog note the rollover created is deleted
- The restoration is complete regardless of how many todos or sub-headings were involved
- Anything you typed into those notes after the rollover is overwritten too, so use undo right away

If the Templater plugin is enabled, `Undo last rollover` only restores the previous day's note and the backlog note, and leaves today's note as it is, because Templater rewrites a new note after the todos are added and restoring an earlier version would replace its output. Remove the rolled over todos from today's note yourself in that case. There is nothing to undo if the rollover changed neither of them.

Note that if you create a daily note in the future, and you try to run this command, todos will not be rolled into a future date. They will always be rolled to today's note (if it doesn't exist, nothing will happen), from the chronologically closest (in the past) daily note.

## Requirements

- [ ] Obsidian 1.1.0 or newer.
- [ ] You must have either:
  1. `Daily notes` plugin installed _or_
  2. `Periodic Notes` plugin installed AND the **Daily Notes** setting toggled on
- [ ] Today's daily note and at least one earlier daily note, in the folder set in one of these plugins (the vault root when none is set). Daily notes are recognised by their name, which must follow the format you use for daily notes (for example `2021-08-29` for `YYYY-MM-DD`). Notes whose names do not match are ignored.

## Settings

The settings are in six groups, in the order a rollover runs. A setting that depends on another sits indented under it, and is greyed out with a note saying what turns it on while it doesn't apply; its value is kept. The `?` button on each group heading opens a short explanation of that group.

### When it runs

#### Automatic rollover for new daily notes

On by default: todos are rolled over when a new daily note is created. Turn it off if you prefer to trigger the rollover manually with the `Rollover Todos Now` command.

#### Review automatic rollovers

**Never** (default): automatic rollovers run without asking, exactly as before. **Only when a todo is stale**: the review dialog opens for an automatic rollover only if a todo has reached the **Stale after** limit. **Always**: it opens every time there is something to roll. Closing the dialog skips that rollover, with a notice; run `Review and roll over todos…` when you are ready. The `Review and roll over todos…` command always shows the dialog.

### Which todos roll over

#### Done status markers

By default, the plugin considers checkboxes containing 'x', 'X', or '-' as completed tasks that won't be rolled over. You can customize this by adding any characters that should be considered "done" markers. For example, adding '?+>' would also treat checkboxes like '[?]', '[+]', and '[>]' as completed tasks. This is useful for users of custom status markers like the [Obsidian Tasks](https://publish.obsidian.md/tasks/Introduction) plugin.

The plugin supports Unicode characters, including complex emoji and grapheme clusters, in checkbox content. This means you can use emojis or special Unicode characters as status markers and they will be handled correctly.

#### Roll over children of todos

By default, only the actual todos are rolled over. If you add nested Markdown elements beneath your todos, these are not rolled over but stay in place. Toggling this setting on allows for also migrating the nested elements, including ones that are completed.

#### Skip completed children

Only applies when **Roll over children of todos** is on. Completed nested todos (using the done status markers from **Done status markers**), and everything nested beneath them, are not rolled over. A completed item that still has an open todo somewhere beneath it is rolled over with it, so open work is never left behind. If **After rollover** is set to delete, they are removed from the previous note together with their rolled parent, so no orphaned child lines are left behind. Use `Undo last rollover` to bring them back.

#### Remove empty todos

By default, this plugin will roll over anything that has a checkbox, whether it has content or not. Toggling this setting on will ignore empty todos. An empty todo is a `- [ ]` with nothing after the checkbox; empty `*` or `+` todos are not recognised. If **After rollover** is set to delete, it will also delete empty todos, except a nested one under a todo you cancel or leave in the review dialog.

#### Ignore todos in callouts and blockquotes

Todos inside Markdown blockquotes (lines starting with `>`), such as habit lists kept in a `> [!tip]` callout, are not rolled over. Off by default.

#### Skip todos already in today's note

Off by default. When on, a todo is not rolled over if today's note already contains the same line (compared ignoring surrounding whitespace, checkbox included). This is useful when your daily template already contains recurring tasks such as `- [ ] Standup`. With **Roll over children of todos** on, a duplicate is skipped together with its nested items only when every open todo nested under it is already in today's note too; otherwise the whole group is rolled over so that nothing is lost. Completed nested todos and plain notes never stop a skip: they are skipped with the parent (and removed with it when **After rollover** is set to delete), unless an open todo is nested under them, which then has to be in today's note. A nested item that matches while its parent does not is still rolled over. Skipped todos still count as handled for **After rollover**: they are marked or deleted on the previous day's note, so they don't pile up there.

#### Which lines count as todos

A todo is a list item (`-`, `*` or `+`) with a checkbox at the start of the line, optionally indented or inside a blockquote. The checkbox holds exactly one character, and it is open unless that character is one of the **Done status markers**, so `- [/]` is rolled over unless you add `/` there. Lines where something else comes before the bullet, such as `1. - [ ] task`, are not treated as todos, and neither is anything inside a fenced code block (` ``` ` or `~~~`), including a block that is never closed. A code block nested under a todo still rolls over with that todo when child items are included.

### Where they go in today's note

#### Template heading

If you chose a template file to use for new daily notes in `Daily notes > Settings` or `Periodic Notes > Settings`, you will be able to choose a heading for incomplete notes to roll into. Incomplete todos are taken from the entire file. They are rolled into today's daily note under the heading of choice, and the headings they were under in the previous note are recreated just below it, keeping the levels they had. A recreated heading at the same or a higher level than the template heading is therefore not nested inside it, so give the template heading a higher level (fewer `#`) than the headings you want under it. A heading that today's note already has is reused only when it sits inside its parent heading's section, so a heading of the same name under another parent is not mistaken for it.

If you leave this field as blank, or select `None`, then incomplete todos will be rolled onto the end of today's note (for new notes with no template, the end is the beginning of the note). Each todo is placed under the same heading it had in the previous note, nested the same way. A heading that today's note already has is reused (ignoring case and surrounding spaces) when it sits inside its parent heading's section; headings that are missing are created at the end of the note when none of a todo's headings exist, and otherwise at the end of the section of the deepest heading that does. Todos that were not under any heading are added without one.

If the plugin cannot read headings from your template (the template is missing or unreadable, or has no headings), the dropdown is replaced by a text field where you can type the exact heading, e.g. `## Tasks`, or `none`.

#### Blank line after a heading

On by default. Puts a blank line between a heading and the rolled over todos placed directly under it, and before a heading that the rollover adds. Todos added to a list that is already under a heading continue that list, without a blank line.

### What happens to the previous day's note

#### After rollover, on the previous day's note

By default, this plugin makes a copy of incomplete todos. So if you forgot to wash your dog yesterday, and didn't check it off, then you will have an incomplete checkmark on yesterday's daily note, and a new incomplete checkmark will be rolled into today's daily note. You can choose what happens to the rolled todos on yesterday's note once today's note has a copy of them:

- **Leave them alone** (default): yesterday's note is unchanged.
- **Mark them**: the rolled todos get a different checkbox character, so `- [ ] wash the dog` becomes `- [>] wash the dog`. The character is configurable (default `>`, the bullet-journal "forwarded" symbol). Only open todos are marked, including open children; completed children and plain text are left as they are. While this option is selected the marker also counts as a done marker (without changing your **Done status markers** setting), so marked todos are not rolled over again.
- **Delete them**: the rolled todos are removed from yesterday's note. This is destructive. Headings whose todos all moved over are removed too, since they now live in today's note. Headings that were already empty, and lines starting with `#` inside code blocks, are left alone.

For example, with no template heading and **Delete them** selected, this in yesterday's note:

```markdown
- [x] Do the dishes
- [ ] Take out the trash
```

leaves `- [x] Do the dishes` in yesterday's note and adds `- [ ] Take out the trash` to today's. With **Leave them alone** both lines would stay in yesterday's note.

If you use the `Undo last rollover` command, marked or deleted todos will be restored (remember, the time limit on this is 2 minutes). If you previously had **Delete todos from previous day** turned on, your setting is carried over as **Delete them**.

#### Move nested items when marking

Off by default. Only applies when **After rollover** is set to mark and **Roll over children of todos** is on. The marked todo stays in the previous day's note as a single line, while everything that was rolled over beneath it (plain bullets, notes and nested todos) moves to today's note and is removed from the previous one. This keeps the hierarchy from being shown in both notes.

Whether completed nested todos move is decided by **Skip completed children**. With **Skip completed children** on they are not rolled over, so they stay in the previous day's note under the marked todo. With it off they are rolled over with the hierarchy and move with it. Nested items that were not moved, for example under a todo that was skipped by **Skip todos already in today's note**, stay where they are.

### Review and backlog

#### Cancel marker

The checkbox character a todo gets when you choose **Cancel** in the review (default `-`, so `- [ ] call Sam` becomes `- [-] call Sam`). It must be a single character; anything else falls back to `-`. Cancel is offered only when this character is one of the **Done status markers**, so a cancelled todo is not rolled over again; the settings page tells you when it is not.

#### Backlog note

The path of the note that receives todos you send to the backlog, for example `Backlog.md` (the plugin creates the note, and any missing folder, if needed). Leave it empty to turn the **Backlog** outcome off. It cannot be today's note or the previous daily note.

#### Backlog heading

An optional heading in the backlog note to add todos under, for example `## Someday`; it is created if the note does not have it. Text that is not already a heading (one to six `#` and a space), such as `Someday` or `#someday`, becomes a level 2 heading. Leave it empty to add todos at the end of the note.

### Aging

#### Count rollovers

Off by default, so your notes are not touched. When on, each todo that is rolled over gets a counter that goes up by one per rollover (not per day), written into the first line of the todo as an inline field that Dataview can query:

```markdown
- [ ] Write the quarterly report [rolled:: 3]
```

The counter goes before the first [Obsidian Tasks](https://publish.obsidian.md/tasks/Introduction) emoji field if the line has one (📅, 🔁 and so on), so Tasks still reads its fields from the end of the line:

```markdown
- [ ] Write the quarterly report [rolled:: 3] 📅 2026-11-10
```

Otherwise it goes before a trailing block id (`^abc123`), otherwise at the end. Nested items are rolled unchanged. The previous day's note is not rewritten, so a marked todo keeps its old count (`- [>] Write the quarterly report [rolled:: 2]`). **Skip todos already in today's note** ignores the counter when comparing.

#### Stale after

Used when **Count rollovers** is on (default 5). A todo is stale once it has been rolled over this many times, so with 5 it is flagged on the sixth rollover. Stale todos get a badge in the review dialog, can open the review for automatic rollovers, and follow **When a todo is stale**. Use 0 to never treat todos as stale.

#### When a todo is stale

**Keep rolling it** (default) or **Move it to the backlog**. This sets the default outcome of stale todos in the review dialog, and decides what happens to them when no review is shown: with **Move it to the backlog**, a stale todo goes to the backlog instead of today's note, and the rollover notice says how many. It needs a **Backlog note**; without one, stale todos keep rolling.

## Bugs/Issues

1. Sometimes you will use this plugin, and your unfinished todos will stay in the same spot. These could be formatting issues. A line is only a todo when it looks like this (see _Which lines count as todos_ above): optional indentation (spaces or tabs) and `>` blockquote markers, a bullet (`-`, `*` or `+`), one space, then `[`, a single character that is not a done marker, `]`, and your text.

1. Sometimes, if you trigger the `rollover` function too quickly, it will read the state of a file before the new data was saved to disk. For example, if you add a new incomplete todo to yesterday's daily note, and then quickly run the `Rollover Todos Now` command, it may grab the state of the file a second or two before you ran the command. If this happens, just run the `Undo last rollover` command. Wait a second or two, then try rolling over todos again.

1. There are sometimes conflicts with other plugins that deal with new notes -- particularly the Templater plugin, which rewrites a new note shortly after it is created and can overwrite the rolled todos. When Templater is enabled and **After rollover** is set to mark or delete, the plugin waits 3 seconds, checks that the rolled todos are still in today's note, and otherwise leaves the previous day's note unchanged and shows a notice; run `Rollover Todos Now` to try again. This is a safety net, not a fix: a template slower than 3 seconds (for example one that calls the web) can still overwrite the todos after the check, and plugins other than Templater are not covered. If that affects you, disable the automatic rollover and trigger it manually after the note is created.

## Installation

This plugin is not yet in Obsidian's community plugin list. Searching there for "Rollover Daily Todos" finds the original plugin, not this one. Until it is listed, install it in one of two ways:

- **BRAT:** open BRAT settings → _Add Beta Plugin_ → enter `hoshposh/obsidian-rollover-daily-todos`.
- **Manually:** download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/hoshposh/obsidian-rollover-daily-todos/releases), put them in `<your vault>/.obsidian/plugins/rollover-daily-todos-lw/`, then enable the plugin under _Community plugins_.

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

4. **Create a GitHub release** with `main.js`, `manifest.json` and `styles.css` attached as assets. All three are required — BRAT uses `manifest.json` to read the version, `main.js` as the plugin bundle and `styles.css` for the review dialog:

   ```bash
   gh release create 1.3.0 main.js manifest.json styles.css --repo hoshposh/obsidian-rollover-daily-todos --prerelease --title "1.3.0" --notes "Release notes here"
   ```

   Keep `--repo`: a checkout that also has the upstream as a remote can make `gh` default to the upstream repository. Drop `--prerelease` for a stable release.

5. **Install via BRAT** in Obsidian: open BRAT settings → _Add Beta Plugin_ → enter `hoshposh/obsidian-rollover-daily-todos`. BRAT will pull the latest release automatically.
