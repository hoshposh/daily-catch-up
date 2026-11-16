// The Rules settings group and the rule dialog. The settings window is a
// popout window in Obsidian 1.15, so the helpers query its own document.
import { afterEach, expect, test } from "vitest";
import {
  awaitAsync,
  evalJs,
  evalJson,
  screenshot,
  setMobile,
  setViewportWidth,
  startAsync,
  waitFor,
} from "./helpers/obsidian";
import {
  horizontalOverflow,
  pressEscape,
  runCommand,
  waitForIdle,
  waitForReview,
} from "./helpers/rollover";
import {
  SETTINGS_DOC,
  clickRuleControl,
  clickSettingsButton,
  fillRuleDialog,
  markOutsideRules,
  markStillThere,
  openSettings,
  ruleControlDisabled,
  ruleDialog,
  ruleRows,
  scrollRulesIntoView,
  setTextSetting,
  settingsMaxScrollTop,
  settingsScrollTop,
  toggleRule,
} from "./helpers/settings-tab";
import {
  day,
  expectNoErrors,
  fixture,
  plugin,
  reset,
  standardNotes,
} from "./helpers/vault";

const BACKLOG = "Backlog/Backlog.md";
const BACKLOG_NOTE =
  'Set a Backlog note (in "Review and backlog") to use this rule.';

afterEach(expectNoErrors);

async function freshSettings(notes = standardNotes()) {
  await reset({ notes, settings: { backlogNotePath: BACKLOG } });
  await openSettings();
}

test("examples are listed switched off", async () => {
  await freshSettings();
  const rows = await ruleRows();
  expect(rows).toHaveLength(9);
  expect(rows.every((row) => row.enabled === false)).toBe(true);
  expect(rows[0].summary).toBe("Tag #someday → Backlog");
});

test("rule changes redraw only the Rules group", async () => {
  await freshSettings();
  await scrollRulesIntoView();
  const scrollTop = await settingsScrollTop();
  expect(scrollTop).toBeGreaterThan(0);
  // an element outside the group: a full redraw of the tab would replace it
  await markOutsideRules();
  const unchanged = async () => {
    expect(await settingsScrollTop()).toBe(scrollTop);
    expect(await markStillThere()).toBe(true);
  };

  await toggleRule(0);
  await waitFor(async () => (await ruleRows())[0]?.enabled, {
    message: "rule 1 to be switched on",
  });
  expect(await evalJson(`${plugin}.settings.rules[0].enabled`)).toBe(true);
  await unchanged();

  await clickRuleControl(1, "Move up");
  await waitFor(
    async () => (await ruleRows())[0]?.summary === "Tag #maybe → Backlog",
    { message: "#maybe to move up" }
  );
  await unchanged();

  await clickRuleControl(0, "Delete");
  await waitFor(async () => (await ruleRows()).length === 8, {
    message: "a rule to be deleted",
  });
  // the page is one row shorter now: when it was scrolled near the bottom
  // (a tall settings window), the browser has to lower the position by up
  // to that much, which is not a jump
  expect(await settingsScrollTop()).toBe(
    Math.min(scrollTop, await settingsMaxScrollTop())
  );
  expect(await markStillThere()).toBe(true);
});

test("an invalid regex cannot be saved", async () => {
  await freshSettings();
  await clickSettingsButton("Add rule");
  await fillRuleDialog({ match: "regex", value: "(" });
  const dialog = await ruleDialog();
  expect(dialog.problemVisible).toBe(true);
  expect(dialog.problem).toMatch(/^This pattern is invalid:/);
  expect(dialog.saveDisabled).toBe(true);

  await clickSettingsButton("Cancel");
  await waitFor(async () => (await ruleDialog()) === null, {
    message: "the rule dialog to close",
  });
  expect(await ruleRows()).toHaveLength(9);
});

test("clearing the backlog note explains the backlog rules", async () => {
  await freshSettings();
  const notes = async () =>
    Object.fromEntries((await ruleRows()).map((r) => [r.summary, r.note]));
  expect((await notes())["Tag #someday → Backlog"]).toBe("");

  await setTextSetting("Backlog note", "");
  await waitFor(
    async () => {
      const now = await notes();
      return (
        now["Tag #someday → Backlog"] === BACKLOG_NOTE &&
        now["Tag #maybe → Backlog"] === BACKLOG_NOTE
      );
    },
    { message: "the backlog rules to explain themselves" }
  );
});

test("the Rules group fits a phone", async () => {
  await reset({
    notes: standardNotes(),
    settings: { backlogNotePath: BACKLOG },
  });
  // in mobile mode the settings open in the main window, which can be
  // narrowed (the popout window stops at 600 px). Narrow first: switching
  // mobile mode reloads the app, which picks the phone layout only when the
  // window is already narrow (otherwise a tablet layout with a sidebar).
  await setViewportWidth(375);
  await setMobile(true);
  expect(await evalJson("innerWidth")).toBe(375);
  expect(await evalJson("document.body.classList.contains('is-phone')")).toBe(
    true
  );
  // something elsewhere in the window that never stops animating (like a
  // sync indicator), out of sight; waiting for the dialog must ignore it
  await evalJs(`(() => {
    const spinner = document.body.createDiv({ cls: 'e2e-spinner' });
    spinner.style.cssText = 'position: fixed; top: -20px; left: 0; width: 10px; height: 10px;';
    spinner.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 1000, iterations: Infinity });
    return true;
  })()`);
  await openSettings();
  expect(await evalJson(`${SETTINGS_DOC} === document`)).toBe(true);
  // The dialog slides in. Its animations only advance while Obsidian paints
  // the window, which it may not do in the background, so they are skipped
  // to their end state instead of waited for. Only the dialog's own
  // animations, and only ones that end (anything else in the window, like
  // the spinner above, is left alone).
  const settle = `(() => {
    const own = document.getAnimations().filter((a) => {
      const target = a.effect?.target;
      return target && app.setting.containerEl.contains(target) &&
        a.effect.getTiming().iterations !== Infinity;
    });
    own.forEach((a) => a.playState === 'running' && a.finish());
    return own.every((a) => a.playState !== 'running');
  })()`;
  await waitFor(async () => evalJson(settle), {
    message: "the settings dialog to finish opening",
  });
  await scrollRulesIntoView();

  expect(await horizontalOverflow(".rollover-rules")).toBe(0);
  await screenshot("rules-settings-phone");
  await evalJs("document.querySelector('.e2e-spinner')?.remove(); true");
});

test("a rule added in the dialog is saved and used", async () => {
  await freshSettings({
    "templates/daily.md": fixture("daily-template.md"),
    [`daily/${day(-1)}.md`]: "# Work\n\n## Errands\n\n- [ ] Post the parcel\n",
    [`daily/${day()}.md`]: fixture("daily-template.md"),
  });

  await clickSettingsButton("Add rule");
  await fillRuleDialog({ match: "heading", value: "Errands", effect: "leave" });
  expect((await ruleDialog()).saveDisabled).toBe(false);
  await clickSettingsButton("Save");
  await waitFor(async () => (await ruleRows()).length === 10, {
    message: "the new rule's row",
  });
  const last = (await ruleRows()).at(-1);
  expect(last.summary).toBe('Heading "Errands" → Leave');
  expect(last.enabled).toBe(true);
  const added = {
    enabled: true,
    match: "heading",
    value: "Errands",
    effect: "leave",
  };
  expect(await evalJson(`${plugin}.settings.rules.at(-1)`)).toMatchObject(
    added
  );
  // saved, not only in memory: what the plugin reads back after a restart
  await waitFor(
    async () => {
      await startAsync(
        `return (await ${plugin}.loadData())?.rules?.at(-1) ?? null;`
      );
      const stored = await awaitAsync();
      return stored?.value === "Errands" ? stored : null;
    },
    { message: "the new rule in data.json" }
  ).then((stored) => expect(stored).toMatchObject(added));

  await evalJs("app.setting.close(); true");
  await runCommand("review-and-rollover");
  const rows = await waitForReview();
  const parcel = rows.find((row) => row.label === "Post the parcel");
  expect(parcel?.outcome).toBe("leave");
  expect(parcel?.badges).toContain('Heading "Errands"');
  await pressEscape();
  await waitForIdle();
});

test("the first rule cannot move up, the last cannot move down", async () => {
  await freshSettings();
  expect(await ruleControlDisabled(0, "Move up")).toBe(true);
  expect(await ruleControlDisabled(0, "Move down")).toBe(false);
  expect(await ruleControlDisabled(8, "Move down")).toBe(true);
  expect(await ruleControlDisabled(8, "Move up")).toBe(false);

  const summaries = async () => (await ruleRows()).map((r) => r.summary);
  const before = await summaries();
  await clickRuleControl(0, "Move up");
  await clickRuleControl(8, "Move down");
  expect(await summaries()).toEqual(before);

  await clickRuleControl(0, "Move down");
  await waitFor(
    async () => (await ruleRows())[1]?.summary === "Tag #someday → Backlog",
    { message: "#someday to move down" }
  );
  expect((await summaries()).slice(0, 2)).toEqual([
    "Tag #maybe → Backlog",
    "Tag #someday → Backlog",
  ]);
  expect(
    await evalJson(`${plugin}.settings.rules.slice(0, 2).map((r) => r.id)`)
  ).toEqual(["example-2", "example-1"]);
  // the ends follow the new order
  expect(await ruleControlDisabled(0, "Move up")).toBe(true);
  expect(await ruleControlDisabled(1, "Move up")).toBe(false);
});

test("editing a rule shows its values and saves in place", async () => {
  await freshSettings();
  const stored = () => evalJson(`${plugin}.settings.rules[0]`);
  const original = await stored();

  await clickRuleControl(0, "Edit");
  await waitFor(async () => (await ruleDialog()) !== null, {
    message: "the rule dialog",
  });
  let dialog = await ruleDialog();
  expect(dialog.fields).toMatchObject({
    match: "tag",
    value: "#someday",
    effect: "backlog",
  });
  expect(dialog.targetVisible).toBe(false);

  // Cancel keeps the rule as it was, even after typing
  await fillRuleDialog({ value: "#later" });
  await clickSettingsButton("Cancel");
  await waitFor(async () => (await ruleDialog()) === null, {
    message: "the rule dialog to close",
  });
  expect(await stored()).toEqual(original);
  expect((await ruleRows())[0].summary).toBe("Tag #someday → Backlog");

  // Move to heading asks for a target before it can be saved
  await clickRuleControl(0, "Edit");
  await fillRuleDialog({ value: "#later", effect: "move" });
  dialog = await ruleDialog();
  expect(dialog.targetVisible).toBe(true);
  expect(dialog.problem).toBe("Enter the heading to move to.");
  expect(dialog.saveDisabled).toBe(true);
  await fillRuleDialog({ target: "Later" });
  expect((await ruleDialog()).saveDisabled).toBe(false);
  await clickSettingsButton("Save");
  await waitFor(
    async () =>
      (await ruleRows())[0]?.summary === "Tag #later → Move to ## Later",
    { message: "the edited rule's row" }
  );
  // same rule, same place, still switched off
  expect(await ruleRows()).toHaveLength(9);
  expect((await ruleRows())[0].enabled).toBe(false);
  expect(await stored()).toEqual({
    ...original,
    value: "#later",
    effect: "move",
    target: "Later",
  });
});
