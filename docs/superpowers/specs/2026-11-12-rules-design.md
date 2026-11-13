# Rules

Design for the "rules first" part of Phase 4 (smart filtering) in `docs/roadmap.md`: tag rules, per-heading rules and a regex exclude, built as one rule list in a new settings section. Brainstormed on 2026-11-12. Decisions made in that conversation are marked as such; everything else is a call made from the code and is listed under [Calls to check](#calls-to-check).

## Intent

Daily Catch-Up carries todos forward on purpose and notices the ones that never get done. Today every open todo is treated alike: it rolls (or goes to the backlog when stale), and its counter rises. Many workflows have todos that should not be treated alike:

- GTD tags: `#someday` / `#maybe` belong in a Someday/Maybe list, `#waiting` is delayed by someone else, `#habit` is just missed, `@errands` is a context.
- Notes with mixed sections: checkboxes under `## Meetings` are agenda points or attendance, `## Log` uses checkboxes as a log, `## Top 3 today` should not claim priority again tomorrow.
- Personal conventions: `- [ ] @Alice` used as data, an `idea:` prefix.

Rules let each of these get the right default treatment, and stop the stale counter raising false alarms on todos that are not really slipping.

Audience (decided): other people's projected workflows. The maintainer would use some rules, but the scope is set by the use cases in `docs/roadmap-phase-4-use-cases.md`, not by one vault.

Success looks like:

- A GTD user turns on two example rows and has a working Someday/Maybe list and no stale flags on `#waiting` todos, without writing a rule.
- A user can tell, in the review dialog, which rule chose an item's default.
- A user who never touches the Rules section sees no change at all.

## Goals

1. A rule list in its own settings section. Each rule matches by tag, heading or regex and has one effect (decided: one list of match → effect rows, like email filters).
2. Effects: set the default outcome (Roll, Backlog, Cancel, Leave); Not a todo; No stale count; Move to heading.
3. Example rules shipped with the plugin, present for everyone and each switched off (decided).
4. Rules shown as one-line summaries in settings, edited in a small dialog (decided).

## Non-goals

- Moving todos to another note (`@errands` → an Errands note). It needs a second write target with its own undo snapshot. Move to heading only.
- Obsidian Tasks dates and recurrence. They are the second half of Phase 4 and need Phase 3's multi-note sourcing.
- Day-of-week or other conditional rules (`## Work` off weekend notes).
- Rules with more than one condition (tag AND heading). One match per row.
- Matching on nested lines. A rule looks at the item's own (head) line and its heading path only.
- A "test this rule" box in the dialog, rule import/export, and a "restore examples" button.

## Anti-goals

- Behaviour changing for anyone on upgrade. Examples ship switched off; with no rule switched on, every path through `rollover()` is exactly as today.
- A rule silently losing a todo. Every effect leaves the todo somewhere visible: Leave and Not a todo keep it in the previous note untouched, Backlog puts it in the backlog note, Move to heading puts it in today's note.
- A rule the user cannot see acting. The review dialog names the rule behind every rule-chosen default.
- A settings page that jumps or re-renders as a whole when a rule is added, edited or reordered.

## Current structure this builds on

`rollover()` in `src/index.js` parses the previous note with `getSections()` (todos grouped by full heading path, with line positions), then runs the three steps in `src/rollover-plan.js`:

1. `planDecisions()`: drop empty todos, `toItems()`, `defaultDecisions()` (Roll, or Backlog for stale items under `staleBehavior: "backlog"`).
2. `applyPlan()`: `applyDecisions()` turns decisions into rolled sections, backlog items and line positions to move, cancel, delete or leave.
3. `planInsert()`: dedupe against today's note, `bumpRolledCounts()`.

`insertSections()` then puts the rolled sections into today's note. The parser already has one skip rule: a checkbox line tagged `#rolled` (`hasRolledMarker()`) and everything nested under it is never found. Logic lives in pure, tested modules; `index.js` and `src/ui/` are thin and untested. This design keeps that split.

## Rules

### Shape

Stored in settings as `rules`, an ordered array:

```js
{
  id: "r1",            // stable, for the dialog and the review label
  enabled: false,
  match: "tag" | "heading" | "regex",
  value: "#someday",   // tag, heading text or pattern
  effect: "roll" | "backlog" | "cancel" | "leave" | "ignore" | "noStale" | "move",
  target: "## Inbox",  // only with effect "move"
}
```

`ignore` is shown to the user as "Not a todo", `noStale` as "No stale count", `move` as "Move to heading".

### Matching

All matching looks at the item's head line (the open todo line; its nested lines never count) and the heading path of its section.

- **Tag.** The value is a tag, with or without the leading `#`. It matches the tag on the head line as a whole tag, and its nested tags: `#someday` matches `#someday` and `#someday/later`, not `#somedayish`. Case-insensitive, as in Obsidian. Uses the same tag-end rule as `hasRolledMarker()`. A value starting with `@` (`@errands`) is matched the same way as a word starting with `@`, since GTD contexts are often written that way and are not Obsidian tags.
- **Heading.** The value is heading text, with or without leading `#`s. It matches when any heading in the section's heading path has that text, ignoring level, case and surrounding spaces. `Meetings` matches `### Meetings` under `## Work`. It never matches part of a heading.
- **Regex.** The value is a JavaScript pattern, compiled with the `u` flag, case-sensitive. It is tested against the head line's text after the list marker and checkbox (`- [ ] `, `1. [ ] `, blockquote `> ` prefixes) are removed, so `^idea:` and `^@\w+$` work as written. A pattern that does not compile makes the rule inert (and flagged in settings), never an error during rollover.

Disabled rules, and rules with an empty value (or, for Move, an empty target), never match.

### Combining

Effects fall into four kinds: **outcome** (roll, backlog, cancel, leave), **not a todo**, **no stale count**, and **move**. Rules are tried top to bottom; within each kind the first matching rule wins, and kinds combine. A `#waiting` todo under `## Top 3 today` gets No stale count from one row and Move to heading from another.

Not a todo outranks everything else: the line is never an item, so the other kinds have nothing to act on.

Order is how a user carves out exceptions. Heading rules match anywhere in the path, so `Meetings → Leave` also catches `### Action items` under `## Meetings`; a `Action items → Roll` row placed above it wins for those todos. The help panel says this, with that example. (An outcome row cannot rescue lines from a Not a todo row, since they are different kinds.)

### Effects

| Effect | What happens |
| --- | --- |
| Roll / Backlog / Cancel / Leave | The item's default outcome. It overrides the stale default (`staleBehavior: "backlog"`), so `Inbox → Roll` means always Roll. The review dialog can still change it. With no review, it is what happens. |
| Not a todo | The parser never finds the line, like a `#rolled` line: it and everything nested under it (blank lines included) are not rolled, not shown in the review, and never touched by the source action. A heading the rollover empties is still removed only if the rollover emptied it, so a heading with only ignored lines stays. |
| No stale count | The item's `[rolled:: n]` is not raised when it rolls, and it is never stale (no badge, never defaulted to Backlog, never makes `reviewOnAutoRollover: "stale"` open the dialog), whatever its existing count. Takes effect only with `trackRolloverCount`. |
| Move to heading | When the item's final outcome is Roll, it goes under the target heading in today's note instead of under its own headings. See below. |

A rule outcome that is not available is ignored, and the item falls back to the default it would have without that rule (the next matching outcome rule does not take over; it is a configuration problem the settings tab points out):

- Backlog when no backlog note is set.
- Cancel when `isCancelAvailable()` is false.

### Move to heading

The target is a heading line. Text without leading `#`s gets a `## ` prefix, as `backlogHeading` does.

- The target is looked for in the whole of today's note, by text, ignoring level and case, and the first match is used, whatever `templateHeading` says.
- When today's note does not have it, it is created at the end of the note, at the level given, even when a template heading is set.
- All items moved to the same target go under it together, in the order they had in the previous note. Their own headings are not recreated.
- Moving changes only where the item lands. Skip-existing dedupe, counters and the source action treat it like any rolled item.

## Settings

### Section

A seventh group, **Rules**, after Aging, with a `?` help panel like the other groups (text in `settings-text.js`). The group lists one row per rule, then an **Add rule** button.

```
Rules                                                    ?
  [on ] Tag #someday → Backlog                     ✎ ↑ ↓ ✕
  [off] Tag #waiting → No stale count              ✎ ↑ ↓ ✕
        Needs "Track how many times a todo rolled" on
  [off] Heading "Top 3 today" → Move to ## Inbox   ✎ ↑ ↓ ✕
  [on ] Regex ^@\w+$ → Not a todo                  ✎ ↑ ↓ ✕
  [ Add rule ]
```

Each row has an on/off toggle, the rule as a sentence, and edit, move up, move down and delete buttons. Below the sentence, a note says why the rule does nothing when that is so, in the style of `dependentSettingStates()`:

- Backlog with no backlog note set.
- Cancel when the cancel marker is not a done marker.
- No stale count with `trackRolloverCount` off.
- An invalid pattern or empty value.

Only the Rules group's own container re-renders when the list changes; the rest of the page is not rebuilt. The notes also refresh when a setting they depend on changes elsewhere on the page (through `refreshDependents()`).

### Edit dialog

A `Modal` (`src/ui/RuleModal.js`) with: match type dropdown, value text field, effect dropdown, and a target heading field shown only for Move to heading. It validates as you type (empty value, a pattern that does not compile, with the error message) and Save stays disabled while invalid. Save writes the rule back; Cancel or closing changes nothing. Add rule opens the same dialog with a new rule, switched on.

### Example rules

When stored settings have no `rules` key (new installs and everyone upgrading), `rules` is set to these, all switched off. Once the key exists it is never reseeded, so deleted examples stay deleted.

| Match | Value | Effect |
| --- | --- | --- |
| Tag | `#someday` | Backlog |
| Tag | `#maybe` | Backlog |
| Tag | `#waiting` | No stale count |
| Tag | `#habit` | Leave |
| Heading | `Meetings` | Leave |
| Heading | `Log` | Not a todo |
| Heading | `Inbox` | Roll |
| Heading | `Top 3 today` | Move to `## Inbox` |
| Regex | `^@\w+$` | Not a todo |

## Review dialog

An item whose default came from a rule shows a small label next to it naming the rule ("Tag #someday"), styled like the stale badge. An item that will be moved shows its target ("→ ## Inbox") while its outcome is Roll. Changing the dropdown overrides the rule as now; the label stays so the user can see what they overrode. Moved items are still listed under their original heading in the dialog, since that is where the user knows them from.

## Where it goes in the code

- **`src/rules.js`** (new, pure): normalising and validating a rule (`ruleProblem()`), the example list, `isIgnoredByRules(line, headingPath, rules)` for the parser, and `ruleResult(headLine, headingPath, rules, availability)` returning `{ outcome, outcomeRule, noStale, noStaleRule, moveTo, moveRule }`. Also the sentence for a rule's summary row.
- **`src/get-todos.js`**: `getSections()` and `getTodosAndSkipped()` take an optional `isIgnored(line, headingPath)` predicate, checked where `hasRolledMarker()` is checked, on open todo lines only, skipping the line and everything nested under it the same way.
- **`src/rollover-plan.js` / `src/rollover-items.js`**: `planDecisions()` attaches each item's rule result; `defaultDecisions()` uses the rule outcome first, then the stale default; `isStale()` and `needsReview()` respect `noStale`. `applyPlan()` gives moved items' rolled sections the target as their heading path, flagged as moved; `planInsert()` skips the counter for `noStale` items.
- **`src/insert-sections.js`**: a moved section looks for its target in the whole note and creates it at the end when missing, ignoring `templateHeading`.
- **`src/index.js`**: the `rules` default and seeding in `loadSettings()`; passing rules and availability into the plan; nothing else.
- **`src/ui/RolloverSettingTab.js`, `src/ui/RuleModal.js`, `src/settings-text.js`, `styles.css`**: the Rules group and dialog.
- **`src/ui/ReviewModal.js`**: the rule and move labels.

Undo needs no change: rules add no new notes to write.

Tests: `src/rules.test.js` for matching, combining and validation; parser tests for the ignore predicate (including nested and blank lines); `rollover-flow.test.js` cases for each effect end to end, including a moved item with a template heading set and a `noStale` item over the threshold. The settings tab, rule dialog and review labels are UI and untested, so their logic (summary sentence, problem notes) lives in `rules.js`.

Docs: README section on rules, CLAUDE.md (new module, settings key, rollover flow), roadmap boxes ticked.

## Left to the builder

- Generating rule ids, and how the up/down/delete buttons look (Obsidian `ExtraButtonComponent` icons are fine). Whether delete asks for confirmation.
- The exact help and summary wording, in the existing style of `settings-text.js`.
- How the moved-section flag and the `noStale` line positions are passed between `applyPlan()`, `planInsert()` and `insertSections()`.
- Whether `ruleResult()` is computed in `planDecisions()` or `toItems()`.

## Calls to check

Calls made without asking, most likely to matter first:

1. **Move to heading ignores the template heading.** The target is looked for in the whole note and created at the end when missing, even when `templateHeading` is set. The alternative, creating it under the template heading, would nest `## Inbox` inside `## Todos` and end that section early.
2. **An unavailable rule outcome falls back to the normal default**, not to the next matching outcome rule.
3. **No stale count also stops the counter rising**, not just the stale flag. The count then means "times it slipped".
4. **Regex is case-sensitive**, tested against the line without its list marker and checkbox.
5. **`@word` values are accepted by Tag rules** as context words.
6. **Rules group placed after Aging**, since rules refer to the backlog and stale settings above them.
7. **Example set**: the nine rows above, including `Log` as Not a todo (its checkboxes are a log, not todos) where `Meetings` is Leave (agenda items may still be worth seeing in the review).
