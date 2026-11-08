# Settings screen: grouped layout, greyed-out dependents and group help

Design for reorganising the plugin's settings tab (`src/ui/RolloverSettingTab.js`). It was agreed with the owner on 2026-11-08 through mockups. Decisions the owner made are marked **(owner)**. Calls made while writing this up are marked **(my call)**.

## Intent

The settings tab has grown to 19 settings. The first twelve have no heading, and in their order they mix four jobs: when the rollover runs, which todos it picks up, where they go, and what happens to yesterday's note. Settings that depend on each other are often far apart. **Automatic rollover** is 11th, while **Review automatic rollovers**, which only matters when it is on, is 13th under another heading. **Backlog note** sits under "Aging", yet the review dialog's Backlog choice depends on it. During manual testing the owner couldn't tell which group some settings were in.

Users mostly open these settings to tweak one specific area **(owner)**. So the screen should let someone who doesn't know the plugin well land in the right group by its name, see how settings depend on each other, and learn what a setting needs before it can be used.

## Goals

1. One scrolling page with six headed groups named for what they affect **(owner)**.
2. A setting that depends on another sits indented directly under it.
3. A setting that doesn't currently apply stays visible but disabled, and says what enables it **(owner)**.
4. Short, one-line descriptions on each setting **(owner)**.
5. A `?` button on each group heading opens a longer explanation in place, under the heading, with the settings still visible below it **(owner)**.

## Non-goals

- No tabs and no collapsible groups **(owner)**: both add clicks for people who don't know the layout yet.
- No setting search, filter or index.
- No change to what any setting does, its stored key or its default. `data.json` is read and written exactly as now, so no migration is needed.
- No README rewrite. It changes only to match the new labels and group order (see "Labels").

## Anti-goals

- A setting hidden because it doesn't apply. Users should always be able to find it and see what it needs.
- The page jumping to the top, or losing the user's place, when a parent setting changes.
- Wording that changes the meaning of a setting. Tightened text must still be accurate against the code.
- Help panels that cover or push away the settings they describe.

## Layout

The groups appear in this order, which follows a rollover from start to finish **(my call)**. `↳` marks a dependent setting, indented under the setting before it.

| Group heading | Settings (stored key) |
|---|---|
| **When it runs** | Automatic rollover for new daily notes (`rolloverOnFileCreate`) · ↳ Review automatic rollovers (`reviewOnAutoRollover`) |
| **Which todos roll over** | Done status markers (`doneStatusMarkers`) · Roll over children of todos (`rolloverChildren`) · ↳ Skip completed children (`skipCompletedChildren`) · Remove empty todos (`removeEmptyTodos`) · Ignore todos in callouts and blockquotes (`ignoreBlockquotes`) · Skip todos already in today's note (`skipExistingTodos`) |
| **Where they go in today's note** | Template heading (`templateHeading`: dropdown, or the text fallback when the template has no readable headings) · Blank line after a heading (`leadingNewLine`) |
| **What happens to the previous day's note** | After rollover (`onRolloverSourceAction`) · ↳ Marker character (`rolloverSourceMarker`) · ↳ Move nested items when marking (`moveNestedItemsOnMark`) |
| **Review and backlog** | Cancel marker (`cancelMarker`) · Backlog note (`backlogNotePath`) · ↳ Backlog heading (`backlogHeading`) |
| **Aging** | Count rollovers (`trackRolloverCount`) · ↳ Stale after (`staleAfterRollovers`) · ↳ When a todo is stale (`staleBehavior`) |

Placement notes:

- **Review automatic rollovers** goes under Automatic rollover, not under "Review and backlog": it only affects automatic runs **(owner, via mockup A)**.
- **Cancel marker** and **Backlog note** move to "Review and backlog", because both shape the review dialog's choices **(my call, which addresses the owner's confusion)**.
- Group headings use `new Setting(el).setName(...).setHeading()`, as the existing Review and Aging headings do.
- Indentation: give dependent rows a class (e.g. `rollover-setting-dependent`) styled in `styles.css` with a left margin and a subtle left border, using theme variables only. This matches the mockup the owner chose.

## When a setting is disabled

A dependent setting is disabled, never hidden, when its condition is false. Its description is then replaced by a sentence saying what enables it. When the condition points to another group, the sentence names that group.

| Setting | Enabled when | Text while disabled **(my call on wording)** |
|---|---|---|
| Review automatic rollovers | `rolloverOnFileCreate` is on | Turn on Automatic rollover to use this. The Review and roll over todos command always shows the review. |
| Skip completed children | `rolloverChildren` is on | Turn on Roll over children of todos to use this. |
| Marker character | `onRolloverSourceAction` is `"mark"` | Set After rollover to "Mark them" to use this. |
| Move nested items when marking | `onRolloverSourceAction` is `"mark"` and `rolloverChildren` is on | Needs After rollover set to "Mark them" and Roll over children of todos turned on (in "Which todos roll over"). The sentence names only the conditions that are currently unmet. |
| Backlog heading | `backlogNotePath` is not empty after trimming | Set a Backlog note to use this. |
| Stale after | `trackRolloverCount` is on | Turn on Count rollovers to use this. |
| When a todo is stale | `trackRolloverCount` is on | Turn on Count rollovers to use this. |

Rules:

- A disabled setting keeps showing its saved value, and the value is kept. Disabling never changes or clears a setting.
- When a parent changes, its dependents update their disabled state and text straight away, without the page scrolling. Updating the affected rows in place is the expected approach. Re-rendering the whole tab is acceptable only if the scroll position is restored.
- Conditions that cross groups update too. For example, turning Roll over children off disables Move nested items further down the page.

Links that don't disable anything are mentioned in a short description note **(my call)**:

- **Remove empty todos:** with After rollover "Delete them", empty todos are still deleted from the previous day's note.
- **Skip todos already in today's note:** skipped todos are still marked or deleted in the previous day's note.
- **Cancel marker:** Cancel is offered only when this character is one of the done status markers. Keep the existing extra line that appears when it is not.
- **Review automatic rollovers:** the "Only when a todo is stale" choice needs Count rollovers (in "Aging"). Obsidian's dropdown can't disable a single option cleanly, so this is a description note, not a disabled option.
- **When a todo is stale:** "Move it to the backlog" needs a Backlog note (in "Review and backlog").

The rules live in a new pure module, `src/settings-dependencies.js`, so they can be unit tested like the other pure modules (CLAUDE.md asks for logic to stay out of the UI). Suggested shape: a function that takes the settings and returns, for each dependent setting, whether it is enabled and, if not, the text to show. The settings tab only renders what it returns.

## Descriptions

Each setting gets one sentence, two at most when a cross-group link note applies. The detail removed from today's descriptions moves into the group help. Suggested text follows **(my call; the builder may polish it but must keep it accurate)**:

| Setting | Short description |
|---|---|
| Automatic rollover for new daily notes | Roll over todos when today's daily note is created. |
| Review automatic rollovers | Show the review dialog before an automatic rollover. |
| Done status markers | Checkbox characters that count as done, e.g. `xX-`. |
| Roll over children of todos | Bring the items nested under a todo along with it. |
| Skip completed children | Leave completed nested todos behind. |
| Remove empty todos | Don't roll over todos with no text. *+ the "Delete them" note above* |
| Ignore todos in callouts and blockquotes | Don't roll over todos in lines that start with `>`. |
| Skip todos already in today's note | Don't roll over a todo that today's note already has. *+ the note above* |
| Template heading | Heading in today's note to put the todos under. The text-field fallback keeps one short sentence on the expected format, e.g. `## Tasks`, or `none` for the end of the note. |
| Blank line after a heading | Add a blank line between a heading and the todos placed under it. |
| After rollover | What to do with rolled todos in the previous day's note. |
| Marker character | Checkbox character "Mark them" uses, e.g. `>`. |
| Move nested items when marking | Keep only the marked todo; its nested items move to today's note. |
| Cancel marker | Checkbox character a todo gets when you choose Cancel. *+ the note above* |
| Backlog note | Note that receives todos you send to the backlog. Empty turns the Backlog choice off. |
| Backlog heading | Heading in the backlog note to add todos under; empty means the end of the note. |
| Count rollovers | Add `[rolled:: n]` to each rolled todo, raised by one per rollover. |
| Stale after | Number of rollovers after which a todo is stale; 0 turns this off. |
| When a todo is stale | What happens to a stale todo when no review is shown. *+ the note above* |

## Labels

Two labels are shortened; their stored keys stay the same **(my call)**:

- "Remove empty todos in rollover" becomes **Remove empty todos**.
- "Add extra blank line between Heading and Todos" becomes **Blank line after a heading**.

Update the README to the new labels and group order:

- the Settings section;
- every other mention of a renamed label, such as "Remove empty todos in rollover";
- the line that refers to settings "Under the **Review** group", now that Backlog note and Cancel marker live in "Review and backlog".

## Group help

Each group heading has a small `?` button at its right **(owner)**.

- It toggles a help panel directly under the heading, pushing the group's settings down without covering them. Clicking it again closes the panel.
- Panels start closed every time the tab opens. Their state is not saved.
- More than one panel may be open at a time.
- Show the button as pressed while its panel is open, and set `aria-expanded` and an accessible label such as "Help: What happens to the previous day's note". It must work by keyboard (Enter or Space) and by click or tap.
- Style the panel with theme variables only, for example a faint accent background and a left accent border as in the mockup. It must work in light and dark themes and wrap at phone width.
- Help text is plain text built with DOM helpers. Use `createEl` and similar, never `innerHTML` (an Obsidian review guideline).

Suggested help text **(my call; keep it accurate against the code and README)**:

- **When it runs:** The rollover runs when today's daily note is created, if Automatic rollover is on. You can also run it any time with **Rollover Todos Now**, or with **Review and roll over todos**, which always shows the review. Review automatic rollovers decides whether an automatic run shows the review first: never, only when a todo is stale (needs Count rollovers), or always. Closing the review skips that rollover and writes nothing.
- **Which todos roll over:** An open todo is a checkbox whose character isn't one of the done status markers. With Roll over children, the bullets and todos nested under it come too, and Skip completed children leaves completed ones behind. Empty todos, todos in callouts or blockquotes, and todos that today's note already has can each be left out. Lines inside fenced code blocks never count as todos.
- **Where they go in today's note:**
  - With a template heading, todos go under it, and the headings they had in the previous day's note are recreated just below it, keeping their levels.
  - With no template heading ("None"), they go under those same headings in today's note, which are created when missing.
  - If today's note doesn't have the template heading, they go to the end of the note and a notice says so.
  - Blank line after a heading separates a heading from the todos placed directly under it. Todos added to an existing list continue it.

  This text was checked against `insertSections()` and the README's "Template heading" section. Keep them consistent.
- **What happens to the previous day's note:** After today's note has a copy of the todos, the previous day's note can be left alone (the safest), marked, or cleaned up. **Mark them** changes each rolled todo's checkbox to the marker character, e.g. `[>]` for forwarded. Completed items and plain text aren't touched. With Move nested items, the nested items move to today's note and only the marked todo stays. **Delete them** removes the rolled todos, and headings left empty go too. **Undo last rollover** reverses either change for 2 minutes.
- **Review and backlog:** The review dialog lets you choose for each todo: **Roll** it to today, send it to the **Backlog** note, **Cancel** it (its checkbox gets the cancel marker), or **Leave** it untouched in the previous day's note. The Backlog choice appears only when a Backlog note is set. The note and its folder are created when missing. Cancel appears only when the cancel marker is one of your done status markers, so a cancelled todo isn't rolled over again.
- **Aging:** With Count rollovers, each rolled todo gets a `[rolled:: n]` counter. The counter goes before any Tasks plugin dates and before a block id, so they keep working. A todo is stale once its count reaches Stale after. Stale todos get a badge in the review, can open the review on their own, and can go straight to the backlog when no review is shown.

## Constraints

- Obsidian `PluginSettingTab` / `Setting` APIs, as today. No new dependencies. CSS goes in `styles.css`, which already ships with the plugin.
- Theme CSS variables only. Usable at phone width.
- The existing behaviours stay:
  - the template-heading dropdown, with its text fallback when the template can't be read;
  - a saved heading missing from the template stays selectable;
  - the Cancel marker "not offered" note.
- Remove the two debug `console.log` calls in the Automatic rollover toggle's `onChange` (`RolloverSettingTab.js`). They log on every toggle and are flagged for community-plugin review anyway **(my call)**.

## Testing

- **Unit tests** (vitest) for `src/settings-dependencies.js`:
  - every row of the disabled table, both enabled and disabled;
  - Move nested items with each of its two conditions unmet, and both;
  - a whitespace-only backlog path;
  - the absence of the cancel-marker or other existing notes is not this module's job unless the builder moves them there.
- **Build:** `pnpm build` succeeds.
- **Manual check in the test vault**, by the owner:
  - Each group shows its settings in the order above.
  - Toggling each parent enables and disables its dependents in place, without the page jumping.
  - Each `?` opens and closes its help panel.
  - Light and dark theme work.
  - The page works at phone width.
  - Values saved before the change still show and still apply.

## Left to the builder

- Final wording of descriptions and help, within the meaning above.
- Whether the help text lives in the settings tab file or a small data module.
- How dependent rows are re-rendered, within the "no jump" rule.
- Exact CSS for indentation, the `?` button and the help panel.
