// The Rules settings group and the rule dialog. The settings window is a
// popout window in Obsidian 1.15, so the helpers query its own document.
import { afterEach, expect, test } from "vitest";
import {
  evalJs,
  evalJson,
  screenshot,
  setMobile,
  setViewportWidth,
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
  ruleDialog,
  ruleRows,
  scrollRulesIntoView,
  setTextSetting,
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
  await unchanged();
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
  await openSettings();
  expect(await evalJson(`${SETTINGS_DOC} === document`)).toBe(true);
  // the dialog slides in; measure and capture it once it has arrived
  await waitFor(
    async () =>
      evalJson(
        "document.getAnimations().every((a) => a.playState !== 'running')"
      ),
    { message: "the settings dialog to finish opening", timeout: 15000 }
  );
  await scrollRulesIntoView();

  expect(await horizontalOverflow(".rollover-rules")).toBe(0);
  await screenshot("rules-settings-phone");
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
  expect(await evalJson(`${plugin}.settings.rules.at(-1)`)).toMatchObject({
    enabled: true,
    match: "heading",
    value: "Errands",
    effect: "leave",
  });

  await evalJs("app.setting.close(); true");
  await runCommand("review-and-rollover");
  const rows = await waitForReview();
  const parcel = rows.find((row) => row.label === "Post the parcel");
  expect(parcel?.outcome).toBe("leave");
  expect(parcel?.badges).toContain('Heading "Errands"');
  await pressEscape();
  await waitForIdle();
});
