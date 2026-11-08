# Settings Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the plugin's settings tab as six headed groups. Dependent settings are indented under their parent, settings that don't apply are greyed out with a reason, descriptions are one line, and each group has an in-place `?` help panel.

**Architecture:** Two new pure modules hold everything testable:
- `src/settings-dependencies.js`: when a dependent setting is enabled, and why not.
- `src/settings-text.js`: group titles, help text, short descriptions and labels.

`src/ui/RolloverSettingTab.js` only renders them. It updates dependents in place after every change, so the page never re-renders or jumps. Styles go in `styles.css`.

**Tech Stack:** Plain JavaScript ES modules, Obsidian `PluginSettingTab`/`Setting` API, rollup, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-08-settings-layout-design.md`

## Global Constraints

- No new dependencies. CSS goes only in `styles.css`, which already ships with `main.js`.
- No setting's stored key, default or behaviour changes, so `data.json` is read and written exactly as now. Defaults stay in `loadSettings()` in `src/index.js`.
- A setting that doesn't apply is disabled, never hidden, and keeps its saved value.
- A parent change must not scroll the page or re-render the whole tab. In particular, the Count rollovers toggle must stop calling `this.display()`.
- Theme CSS variables only. Usable at phone width, and in light and dark themes.
- Build DOM with `createEl`/`createDiv`/`createSpan`/`setText`. Never use `innerHTML`, which an Obsidian community review guideline forbids.
- Group order, group membership and labels are exactly as in the spec's **Layout** and **Labels** sections.
- Commit messages: plain imperative subject, with no `Co-Authored-By` or `Claude-Session` lines (the user's global CLAUDE.md).
- Run prettier only on files a task creates, never repo-wide.
- Tests: `pnpm vitest run <file>` or `pnpm vitest run`. `pnpm build` must exit 0 after any task that touches `src/ui/` or `styles.css`.

## Review Focus

1. **Settings saved before `rolloverOnFileCreate` existed** (key missing): Automatic rollover counts as on, so Review automatic rollovers is enabled. Test in Task 1.
2. **Settings migrated from the old `deleteOnComplete`, or with no `onRolloverSourceAction`:** the action resolves through `resolveSourceAction()`, so Marker character is disabled unless it resolves to `"mark"`. Test in Task 1.
3. **A Backlog note of only spaces:** counts as empty, so Backlog heading is disabled. Test in Task 1.
4. **Changing Done status markers or Cancel marker:** the "Cancel is currently not offered" note updates without reopening the tab. The text comes from a tested pure function (Task 1), and Task 2's refresh calls it after every change.
5. **Help text with an unmatched `**`:** renders literally and never drops text. Test in Task 2.

---

## Setup (before Task 1)

- [ ] Create branch `feat/settings-layout` from `main`.
- [ ] Commit the spec and this plan: `git add docs/superpowers && git commit -m "Add design and plan for the settings layout"`.

---

### Task 1: Dependency rules

**Files:**
- Create: `src/settings-dependencies.js`
- Test: `src/settings-dependencies.test.js`

**Interfaces:**
- Consumes: `resolveSourceAction(settings)` and `isCancelAvailable(settings)` from `src/source-action.js`.
- Produces:
  - `DEPENDENT_SETTINGS`: the array `["reviewOnAutoRollover", "skipCompletedChildren", "rolloverSourceMarker", "moveNestedItemsOnMark", "backlogHeading", "staleAfterRollovers", "staleBehavior"]`.
  - `dependentSettingStates(settings) → Record<key, { enabled: boolean, reason: string }>`, with one entry per `DEPENDENT_SETTINGS` key. `reason` is `""` when the setting is enabled.
  - `cancelMarkerNote(settings) → string`: `""` when `isCancelAvailable(settings)`, otherwise exactly `"Cancel is currently not offered, because this character is not one of the done status markers."`.

The rules are the spec's **When a setting is disabled** table, with two exceptions. `rolloverOnFileCreate` counts as on unless it is exactly `false`. The source action always goes through `resolveSourceAction()`. The `reason` strings are exactly:

| key | reason when disabled |
|---|---|
| reviewOnAutoRollover | `Turn on Automatic rollover to use this. The Review and roll over todos command always shows the review.` |
| skipCompletedChildren | `Turn on Roll over children of todos to use this.` |
| rolloverSourceMarker | `Set After rollover to "Mark them" to use this.` |
| moveNestedItemsOnMark | not marking, children on: `Set After rollover to "Mark them" to use this.` · marking, children off: `Turn on Roll over children of todos (in "Which todos roll over") to use this.` · both unmet: `Needs After rollover set to "Mark them" and Roll over children of todos turned on (in "Which todos roll over").` |
| backlogHeading | `Set a Backlog note to use this.` |
| staleAfterRollovers, staleBehavior | `Turn on Count rollovers to use this.` |

- [ ] **Step 1: Write the failing tests**

```js
import { describe, expect, test } from "vitest";
import { DEPENDENT_SETTINGS, cancelMarkerNote, dependentSettingStates } from "./settings-dependencies";

const s = (o) => dependentSettingStates(o);

test("one state per dependent setting", () => {
  expect(Object.keys(s({})).sort()).toEqual([...DEPENDENT_SETTINGS].sort());
});

describe("Review automatic rollovers", () => {
  test("on when automatic rollover is on or was never saved", () => {
    expect(s({ rolloverOnFileCreate: true }).reviewOnAutoRollover).toEqual({ enabled: true, reason: "" });
    expect(s({}).reviewOnAutoRollover.enabled).toBe(true);
  });
  test("off when automatic rollover is off", () => {
    expect(s({ rolloverOnFileCreate: false }).reviewOnAutoRollover).toEqual({
      enabled: false,
      reason: "Turn on Automatic rollover to use this. The Review and roll over todos command always shows the review.",
    });
  });
});

test("Skip completed children follows Roll over children", () => {
  expect(s({ rolloverChildren: true }).skipCompletedChildren.enabled).toBe(true);
  expect(s({ rolloverChildren: false }).skipCompletedChildren.reason).toBe("Turn on Roll over children of todos to use this.");
});

describe("marking", () => {
  test("Marker character needs the mark action, resolved like the plugin does", () => {
    expect(s({ onRolloverSourceAction: "mark" }).rolloverSourceMarker.enabled).toBe(true);
    expect(s({ onRolloverSourceAction: "delete" }).rolloverSourceMarker.reason).toBe('Set After rollover to "Mark them" to use this.');
    expect(s({}).rolloverSourceMarker.enabled).toBe(false); // resolves to "none"
    expect(s({ onRolloverSourceAction: "bogus" }).rolloverSourceMarker.enabled).toBe(false);
  });
  test("Move nested items names only the unmet conditions", () => {
    const m = (action, children) => s({ onRolloverSourceAction: action, rolloverChildren: children }).moveNestedItemsOnMark;
    expect(m("mark", true)).toEqual({ enabled: true, reason: "" });
    expect(m("none", true).reason).toBe('Set After rollover to "Mark them" to use this.');
    expect(m("mark", false).reason).toBe('Turn on Roll over children of todos (in "Which todos roll over") to use this.');
    expect(m("delete", false).reason).toBe('Needs After rollover set to "Mark them" and Roll over children of todos turned on (in "Which todos roll over").');
  });
});

test("Backlog heading needs a non-blank Backlog note", () => {
  expect(s({ backlogNotePath: "Backlog.md" }).backlogHeading.enabled).toBe(true);
  expect(s({ backlogNotePath: "   " }).backlogHeading.reason).toBe("Set a Backlog note to use this.");
  expect(s({}).backlogHeading.enabled).toBe(false);
});

test("stale settings need Count rollovers", () => {
  for (const key of ["staleAfterRollovers", "staleBehavior"]) {
    expect(s({ trackRolloverCount: true })[key].enabled).toBe(true);
    expect(s({ trackRolloverCount: false })[key].reason).toBe("Turn on Count rollovers to use this.");
  }
});

test("cancelMarkerNote", () => {
  expect(cancelMarkerNote({ doneStatusMarkers: "xX-", cancelMarker: "-" })).toBe("");
  expect(cancelMarkerNote({ doneStatusMarkers: "xX", cancelMarker: "-" })).toBe(
    "Cancel is currently not offered, because this character is not one of the done status markers."
  );
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/settings-dependencies.test.js`
Expected: FAIL, cannot resolve `./settings-dependencies`.

- [ ] **Step 3: Implement `src/settings-dependencies.js`** with the three exports above.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/settings-dependencies.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings-dependencies.js src/settings-dependencies.test.js
git commit -m "Add rules for when dependent settings apply"
```

---

### Task 2: Settings text and help markup

**Files:**
- Create: `src/settings-text.js`
- Test: `src/settings-text.test.js`

**Interfaces:**
- Produces:
  - `SETTING_GROUPS`: an array in spec order, each item `{ id: string, title: string, help: string[] }`, with ids `"when"`, `"which"`, `"where"`, `"previous"`, `"review"`, `"aging"`. Titles are exactly the spec's Layout headings. `help` is a list of paragraphs from the spec's **Group help** text, with `**bold**` markers for the bold words. The builder may split a group's help into paragraphs.
  - `SETTING_LABELS`: `Record<key, string>`, the setting names shown in the tab, covering every key in the Layout table. Use the spec's **Labels** renames ("Remove empty todos", "Blank line after a heading") and keep every other label as it is today.
  - `SETTING_DESCRIPTIONS`: `Record<key, string>`, the spec's **Descriptions** table. The five keys that carry a link note use exactly these strings:
    - removeEmptyTodos: `Don't roll over todos with no text. With "Delete them", empty todos are still deleted from the previous day's note.`
    - skipExistingTodos: `Don't roll over a todo that today's note already has. It is still marked or deleted in the previous day's note.`
    - cancelMarker: `Checkbox character a todo gets when you choose Cancel. Cancel is offered only when it is one of your done status markers.`
    - reviewOnAutoRollover: `Show the review dialog before an automatic rollover. "Only when a todo is stale" needs Count rollovers (in "Aging").`
    - staleBehavior: `What happens to a stale todo when no review is shown. "Move it to the backlog" needs a Backlog note (in "Review and backlog").`

    Template heading has two entries: `templateHeading` for the dropdown and `templateHeadingText` for the text fallback.
  - `helpSegments(paragraph: string) → { text: string, bold: boolean }[]`: splits a paragraph on matched `**…**` pairs. An unmatched `**` stays as literal text, and no text is lost.

- [ ] **Step 1: Write the failing tests**

```js
import { expect, test } from "vitest";
import { SETTING_DESCRIPTIONS, SETTING_GROUPS, SETTING_LABELS, helpSegments } from "./settings-text";

test("six groups in spec order, each with help", () => {
  expect(SETTING_GROUPS.map((g) => g.title)).toEqual([
    "When it runs",
    "Which todos roll over",
    "Where they go in today's note",
    "What happens to the previous day's note",
    "Review and backlog",
    "Aging",
  ]);
  for (const g of SETTING_GROUPS) expect(g.help.length).toBeGreaterThan(0);
});

test("renamed labels", () => {
  expect(SETTING_LABELS.removeEmptyTodos).toBe("Remove empty todos");
  expect(SETTING_LABELS.leadingNewLine).toBe("Blank line after a heading");
});

test("every labelled setting has a short, single-line description", () => {
  for (const key of Object.keys(SETTING_LABELS)) {
    const d = SETTING_DESCRIPTIONS[key];
    expect(d, key).toBeTruthy();
    expect(d.includes("\n"), key).toBe(false);
    expect(d.length, key).toBeLessThanOrEqual(160);
  }
});

test("helpSegments", () => {
  expect(helpSegments("a **b** c")).toEqual([
    { text: "a ", bold: false },
    { text: "b", bold: true },
    { text: " c", bold: false },
  ]);
  expect(helpSegments("plain")).toEqual([{ text: "plain", bold: false }]);
  expect(helpSegments("odd ** marker").map((x) => x.text).join("")).toBe("odd ** marker");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/settings-text.test.js`
Expected: FAIL, cannot resolve `./settings-text`.

- [ ] **Step 3: Implement `src/settings-text.js`.** Copy the help and descriptions from the spec, checking them against the code and the README's settings sections so they stay accurate.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/settings-text.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings-text.js src/settings-text.test.js
git commit -m "Add settings labels, short descriptions and group help"
```

---

### Task 3: Grouped settings tab

**Files:**
- Modify: `src/ui/RolloverSettingTab.js` (rewrite `display()` and its helpers)
- Modify: `styles.css` (append settings-tab styles)

**Interfaces:**
- Consumes:
  - `dependentSettingStates`, `cancelMarkerNote` and `DEPENDENT_SETTINGS` (Task 1);
  - `SETTING_GROUPS`, `SETTING_LABELS`, `SETTING_DESCRIPTIONS` and `helpSegments` (Task 2);
  - the existing `getTemplateHeadings()`, `headingOptions()` and `resolveSourceAction()`.
- Produces: nothing later tasks call.

- [ ] **Step 1: Render the groups.**
  - `display()` empties the container, then renders the groups in `SETTING_GROUPS` order, each with the settings and `↳` nesting from the spec's Layout table.
  - Names and descriptions come from Task 2's maps. Keep every existing control, its placeholder, its value parsing and its save behaviour; this task only moves and relabels them.
  - Keep the template-heading dropdown and its text fallback as they are.
  - Each dependent row gets the class `rollover-setting-dependent` on its `settingEl`.
  - Remove the two debug `console.log` calls in the Automatic rollover `onChange`.

- [ ] **Step 2: Add the group help.**
  - Each group heading is `new Setting(el).setName(title).setHeading()`.
  - Each heading's `controlEl` gets a `<button>` with the text `?` and the classes `clickable-icon rollover-help-button`. Its attributes are `aria-label="Help: <title>"` and `aria-expanded="false"`. A real `<button>`, so Enter and Space work.
  - Directly after the heading, add a `div.rollover-settings-help` with the `hidden` attribute. It holds one `<p>` per help paragraph, with each `helpSegments()` part appended as a text node or a `<strong>`.
  - Clicking the button toggles `hidden`, flips `aria-expanded`, and toggles the class `is-active` on the button.
  - Panels start closed on every `display()`.

- [ ] **Step 3: Disable dependents in place.**
  - Keep a map from each `DEPENDENT_SETTINGS` key to its `Setting` and its control component.
  - `refreshDependents()` applies `dependentSettingStates(this.plugin.settings)` to every key:
    - calls `setting.setDisabled(!enabled)` and `component.setDisabled(!enabled)`;
    - sets the description to `SETTING_DESCRIPTIONS[key]` when enabled, or to `reason` when disabled.
  - It also sets the Cancel marker description to `SETTING_DESCRIPTIONS.cancelMarker`, followed by `" " + cancelMarkerNote(settings)` when that is non-empty.
  - Every setting's `onChange` saves, then calls `refreshDependents()`.
  - `display()` calls `refreshDependents()` once after rendering.
  - The Count rollovers toggle no longer calls `this.display()`.

- [ ] **Step 4: Append styles to `styles.css`.** Use theme variables only:
  - `.rollover-setting-dependent`: an inline-start margin and padding, plus a `border-inline-start` of `2px solid var(--background-modifier-border)` or an accent at low strength.
  - `.rollover-settings-help`: a muted background (e.g. `var(--background-secondary)`), a `border-inline-start` in `var(--interactive-accent)`, padding, `var(--font-ui-small)`, and paragraphs that wrap.
  - `.rollover-help-button.is-active`: shows the pressed state, e.g. `color: var(--interactive-accent)`.

- [ ] **Step 5: Build and test**

Run: `pnpm build && pnpm vitest run`
Expected: the build exits 0, and all tests pass (the existing 278 plus Tasks 1–2).

- [ ] **Step 6: Commit**

```bash
git add src/ui/RolloverSettingTab.js styles.css
git commit -m "Group the settings tab, grey out settings that don't apply, add group help"
```

Manual checks for the owner come after Task 4. They're listed in the spec's **Testing** section.

---

### Task 4: Documentation

**Files:**
- Modify: `README.md` (`## Settings` section, the Usage line at about line 38, and the two "Under the **Review** group" lines)
- Modify: `CLAUDE.md` (Core files and Testing)

- [ ] **Step 1: Update the README.**
  - Reorder `## Settings` into the six groups. Use the group titles as `###` headings and each setting as `####`, keeping today's detailed text, which is fine for the README.
  - Rename the two labels everywhere, including the Usage paragraph that says "Remove empty todos in rollover".
  - Replace "Under the **Review** group" with the new group names.
  - Add one sentence near the top of Settings about the greyed-out settings and the `?` help on each group.

- [ ] **Step 2: Update CLAUDE.md.**
  - Add `src/settings-dependencies.js` and `src/settings-text.js` to Core files, one line each.
  - Mention the grouped, in-place-refreshing settings tab under `src/ui/RolloverSettingTab.js`.
  - Add the two new test files to Testing.

- [ ] **Step 3: Check**

Run: `pnpm exec prettier --check README.md CLAUDE.md && pnpm vitest run && pnpm build`
Expected: all exit 0. If the two docs weren't prettier-clean before your edit, skip prettier and say so.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "Document the grouped settings"
```
