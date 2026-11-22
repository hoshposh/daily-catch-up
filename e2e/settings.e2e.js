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
  setDropdownSetting,
  setTextSetting,
  settingState,
  settingsMaxScrollTop,
  settingsScrollTop,
  toggleRule,
  toggleSetting,
} from "./helpers/settings-tab";
import {
  CHECKLIST_PROFILE,
  closeModals,
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

// Obsidian opens a dialog in the window it last saw focused. A user's click
// focuses the settings window; the helpers' clicks must do the same, or the
// rule dialog opens in the main window whenever that was focused last.
test("the rule dialog opens in the settings window after the main window was focused", async () => {
  await reset({ notes: standardNotes() });
  await openSettings();
  await evalJs("window.dispatchEvent(new FocusEvent('focus')); true");

  await clickRuleControl(0, "Edit");
  await waitFor(
    async () =>
      evalJson(
        `Boolean(document.querySelector('.rollover-rule-modal') || ${SETTINGS_DOC}.querySelector('.rollover-rule-modal'))`
      ),
    { message: "a rule dialog in either window" }
  );
  expect(
    await evalJson(
      `Boolean(${SETTINGS_DOC}.querySelector('.rollover-rule-modal'))`
    )
  ).toBe(true);
  await clickSettingsButton("Cancel");
});

test("the inbox settings wait for an inbox note", async () => {
  await reset({ notes: standardNotes() });
  await openSettings();
  const NEEDS_INBOX = "Set an Inbox note to use this.";
  const dependents = () =>
    evalJson(`(() => {
      const items = [...${SETTINGS_DOC}.querySelectorAll('.setting-item')];
      return ['After rollover, in the inbox', 'Heading for inbox todos'].map((name) => {
        const item = items.find((s) => s.querySelector('.setting-item-name')?.textContent === name);
        return {
          name,
          disabled: item?.classList.contains('is-disabled') ?? null,
          desc: item?.querySelector('.setting-item-description')?.textContent ?? null,
        };
      });
    })()`);

  for (const dependent of await dependents()) {
    expect(dependent, dependent.name).toMatchObject({
      disabled: true,
      desc: NEEDS_INBOX,
    });
  }

  // the Inbox group in view: setting the note must not move it
  await evalJs(`(() => {
    const item = [...${SETTINGS_DOC}.querySelectorAll('.setting-item')].find(
      (s) => s.querySelector('.setting-item-name')?.textContent === 'Inbox note');
    item.scrollIntoView({ block: 'start' });
    return true;
  })()`);
  const scrollTop = await settingsScrollTop();
  // an element outside the inbox settings: a full redraw would replace it
  await markOutsideRules();

  await setTextSetting("Inbox note", "Inbox.md");
  await waitFor(
    async () => (await dependents()).every((d) => d.disabled === false),
    { message: "the inbox settings to be enabled" }
  );
  for (const dependent of await dependents()) {
    expect(dependent.desc, dependent.name).not.toBe(NEEDS_INBOX);
  }
  expect(await evalJson(`${plugin}.settings.inboxNotePath`)).toBe("Inbox.md");
  expect(await settingsScrollTop()).toBe(scrollTop);
  expect(await markStillThere()).toBe(true);
});

test("an inbox set to Mark enables the marker character", async () => {
  // the previous note's action stays at its default, "none"
  await reset({ notes: standardNotes(), settings: { inboxNotePath: "Inbox.md" } });
  await openSettings();
  const marker = () =>
    evalJson(`(() => {
      const item = [...${SETTINGS_DOC}.querySelectorAll('.setting-item')].find(
        (s) => s.querySelector('.setting-item-name')?.textContent === 'Marker character');
      return {
        disabled: item?.classList.contains('is-disabled') ?? null,
        desc: item?.querySelector('.setting-item-description')?.textContent ?? null,
      };
    })()`);

  expect(await marker()).toEqual({
    disabled: true,
    desc: 'Set an After rollover setting to "Mark them" to use this.',
  });

  const changed = await evalJson(`(() => {
    const item = [...${SETTINGS_DOC}.querySelectorAll('.setting-item')].find(
      (s) => s.querySelector('.setting-item-name')?.textContent === 'After rollover, in the inbox');
    const select = item?.querySelector('select');
    if (!select) return false;
    select.value = 'mark';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  expect(changed).toBe(true);
  await waitFor(async () => (await marker()).disabled === false, {
    message: "the marker character to be enabled",
  });
  expect((await marker()).desc).toBe('Checkbox character "Mark them" uses, e.g. ">".');
  expect(await evalJson(`${plugin}.settings.inboxSourceAction`)).toBe("mark");
  expect(await evalJson(`${plugin}.settings.onRolloverSourceAction`)).toBe("none");
});

test("a hand-edited, malformed rule opens as something Save can store", async () => {
  // no match, and a number for a value, as a hand edit of data.json can leave
  await reset({
    notes: standardNotes(),
    settings: {
      backlogNotePath: BACKLOG,
      rules: [{ id: "hand", enabled: false, value: 42, effect: "leave" }],
    },
  });
  await openSettings();
  expect((await ruleRows())[0].summary).toBe("Unknown rule → Leave");

  await clickRuleControl(0, "Edit");
  await waitFor(async () => (await ruleDialog()) !== null, {
    message: "the rule dialog",
  });
  const dialog = await ruleDialog();
  expect(dialog.fields).toMatchObject({
    match: "tag",
    value: "42",
    effect: "leave",
  });
  expect(dialog.problemVisible).toBe(false);
  expect(dialog.saveDisabled).toBe(false);

  await clickSettingsButton("Save");
  await waitFor(
    async () => (await ruleRows())[0]?.summary === "Tag #42 → Leave",
    { message: "the saved rule's row" }
  );
  expect(await evalJson(`${plugin}.settings.rules[0]`)).toEqual({
    id: "hand",
    enabled: false,
    match: "tag",
    value: "42",
    effect: "leave",
  });
});

const AFTER_ROLLOVER = "After rollover, on the previous day's note";
const SKIP_EXISTING = "Skip todos already in today's note";
const LOOK_BACK = "Look back (days)";
const READ_FROM = "Read notes from";

/** lookBackSince as the plugin holds it in memory and as data.json holds it. */
async function storedSince() {
  await startAsync(`return {
    memory: ${plugin}.settings.lookBackSince ?? null,
    file: (await ${plugin}.loadData())?.lookBackSince ?? null,
  };`);
  return awaitAsync();
}

/** Waits until lookBackSince is `since` in memory and in data.json. */
async function waitForSince(since) {
  await waitFor(
    async () => {
      const stored = await storedSince();
      return stored.memory === since && stored.file === since;
    },
    { message: `lookBackSince to be "${since}" in memory and in data.json` }
  );
}

test("Look back waits for Mark or Delete and Skip todos already in today's note", async () => {
  await reset({ notes: standardNotes() });
  await openSettings();
  const NEEDS_BOTH =
    'Needs After rollover set to "Mark them" or "Delete them" and Skip todos already in today\'s note turned on.';
  expect(await settingState(LOOK_BACK)).toMatchObject({
    disabled: true,
    desc: NEEDS_BOTH,
  });
  expect(await settingState(READ_FROM)).toMatchObject({
    disabled: true,
    desc: NEEDS_BOTH,
  });

  await setDropdownSetting(AFTER_ROLLOVER, "mark");
  await waitFor(
    async () =>
      (await settingState(LOOK_BACK)).desc ===
      "Turn on Skip todos already in today's note to use this.",
    { message: "Look back to ask for Skip todos already in today's note" }
  );
  expect((await settingState(LOOK_BACK)).disabled).toBe(true);

  await toggleSetting(SKIP_EXISTING);
  await waitFor(async () => !(await settingState(LOOK_BACK)).disabled, {
    message: "Look back (days) to be enabled",
  });
  expect((await settingState(LOOK_BACK)).desc).toBe(
    "Also read the daily notes from this many days back, for todos stranded there or added late. 0 reads only the previous day's note."
  );
  // Read notes from waits for Look back itself
  expect(await settingState(READ_FROM)).toMatchObject({
    disabled: true,
    desc: "Set Look back to 1 day or more to use this.",
  });
});

test("turning Look back on starts it today, without redrawing the page", async () => {
  await reset({ notes: standardNotes(), settings: CHECKLIST_PROFILE });
  await openSettings();
  expect((await settingState(READ_FROM)).value).toBe("");
  // an element outside the Look back settings: a full redraw would replace it
  await markOutsideRules();

  await setTextSetting(LOOK_BACK, "7");
  await waitForSince(day());
  expect(await evalJson(`${plugin}.settings.lookBackDays`)).toBe(7);
  expect(await settingState(READ_FROM)).toMatchObject({
    disabled: false,
    value: day(),
  });
  expect(await markStillThere()).toBe(true);
});

test("Read notes from saves an earlier date and ignores a later one", async () => {
  await reset({
    notes: standardNotes(),
    settings: { ...CHECKLIST_PROFILE, lookBackDays: 7, lookBackSince: day() },
  });
  await openSettings();
  expect((await settingState(READ_FROM)).value).toBe(day());

  await setTextSetting(READ_FROM, day(-10));
  await waitForSince(day(-10));

  // the field reacts as it is typed into, so a saved date would be in memory now
  await setTextSetting(READ_FROM, day(1));
  expect(await storedSince()).toEqual({ memory: day(-10), file: day(-10) });
});

test("switching After rollover off and on again keeps the date within one settings session", async () => {
  await reset({
    notes: standardNotes(),
    settings: {
      ...CHECKLIST_PROFILE,
      lookBackDays: 7,
      lookBackSince: day(-10),
    },
  });
  await openSettings();
  expect((await settingState(READ_FROM)).value).toBe(day(-10));

  await setDropdownSetting(AFTER_ROLLOVER, "none");
  await waitForSince("");
  expect(await settingState(READ_FROM)).toMatchObject({
    disabled: true,
    value: "",
  });

  // no note changed while the settings were open: the date comes back
  await setDropdownSetting(AFTER_ROLLOVER, "mark");
  await waitForSince(day(-10));
  expect(await settingState(READ_FROM)).toMatchObject({
    disabled: false,
    value: day(-10),
  });
});

test("switching from Leave them alone in a new settings session starts Look back today", async () => {
  await reset({
    notes: standardNotes(),
    settings: {
      ...CHECKLIST_PROFILE,
      lookBackDays: 7,
      lookBackSince: day(-10),
    },
  });
  await openSettings();
  await setDropdownSetting(AFTER_ROLLOVER, "none");
  await waitForSince("");

  // a later session does not remember the date of an earlier one
  await closeModals();
  await openSettings();
  await setDropdownSetting(AFTER_ROLLOVER, "mark");
  await waitForSince(day());
  expect((await settingState(READ_FROM)).value).toBe(day());
});

test("setting Look back to 0 and back keeps the date within one settings session", async () => {
  await reset({
    notes: standardNotes(),
    settings: {
      ...CHECKLIST_PROFILE,
      lookBackDays: 10,
      lookBackSince: day(-10),
    },
  });
  await openSettings();

  // typing 10 -> 20 one key at a time passes through 0
  await setTextSetting(LOOK_BACK, "0");
  await waitForSince("");
  await setTextSetting(LOOK_BACK, "20");
  await waitForSince(day(-10));
  expect((await settingState(READ_FROM)).value).toBe(day(-10));
});

test("switching After rollover from Mark to Delete starts Look back today", async () => {
  await reset({
    notes: standardNotes(),
    settings: {
      ...CHECKLIST_PROFILE,
      lookBackDays: 7,
      lookBackSince: day(-10),
    },
  });
  await openSettings();
  expect((await settingState(READ_FROM)).value).toBe(day(-10));

  // the lines Mark forwarded with ">" would read as open todos under Delete
  await setDropdownSetting(AFTER_ROLLOVER, "delete");
  await waitForSince(day());
  expect(await settingState(READ_FROM)).toMatchObject({
    disabled: false,
    value: day(),
  });

  // back to Mark in the same session: ">" counts again, the date comes back
  await setDropdownSetting(AFTER_ROLLOVER, "mark");
  await waitForSince(day(-10));
  expect((await settingState(READ_FROM)).value).toBe(day(-10));
});
