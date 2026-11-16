// Drives the plugin's settings tab and the rule dialog. In Obsidian 1.15 the
// settings window is a popout window with its own document (in mobile mode
// it is a dialog in the main window), so every query runs in SETTINGS_DOC.
// The rule dialog opens in that same document.
import { evalJs, evalJson, waitFor } from "./obsidian";

export const SETTINGS_DOC = "app.setting.modalEl.ownerDocument";

const ROWS = `[...${SETTINGS_DOC}.querySelectorAll('.rollover-rules .rollover-rule-row')]`;
const PANE = `app.setting.modalEl.querySelector('.vertical-tab-content')`;
const RULE_DIALOG = `${SETTINGS_DOC}.querySelector('.rollover-rule-modal')`;

export async function openSettings() {
  await evalJs(
    "app.setting.open(); app.setting.openTabById('daily-catch-up'); true"
  );
  await waitFor(
    async () =>
      evalJson(
        `Boolean(${SETTINGS_DOC}.querySelector('.rollover-rules .rollover-rule-row'))`
      ),
    { message: "the plugin's settings tab" }
  );
}

export async function ruleRows() {
  return evalJson(`${ROWS}.map((row) => ({
    summary: row.querySelector('.setting-item-name')?.textContent ?? '',
    enabled: row.querySelector('.checkbox-container')?.classList.contains('is-enabled') ?? false,
    note: row.querySelector('.setting-item-description')?.textContent ?? '',
  }))`);
}

async function clickInRow(index, selector, what) {
  const clicked = await evalJson(`(() => {
    const el = ${ROWS}[${index}]?.querySelector(${JSON.stringify(selector)});
    el?.click();
    return Boolean(el);
  })()`);
  if (!clicked) throw new Error(`Rule row ${index} has no ${what}`);
}

export async function clickRuleControl(index, label) {
  await clickInRow(index, `[aria-label="${label}"]`, `"${label}" button`);
}

/** Whether the row's button with this label is shown as disabled. */
export async function ruleControlDisabled(index, label) {
  const disabled = await evalJson(`(() => {
    const el = ${ROWS}[${index}]?.querySelector(${JSON.stringify(
    `[aria-label="${label}"]`
  )});
    return el ? el.classList.contains('is-disabled') : null;
  })()`);
  if (disabled === null) {
    throw new Error(`Rule row ${index} has no "${label}" button`);
  }
  return disabled;
}

export async function toggleRule(index) {
  await clickInRow(index, ".checkbox-container", "switch");
}

export async function settingsScrollTop() {
  return evalJson(`${PANE}.scrollTop`);
}

/** The furthest the settings pane can scroll down right now. */
export async function settingsMaxScrollTop() {
  return evalJson(`${PANE}.scrollHeight - ${PANE}.clientHeight`);
}

/** Scrolls the settings pane so the Rules group is at the top. */
export async function scrollRulesIntoView() {
  await evalJs(
    `${SETTINGS_DOC}.querySelector('.rollover-rules').scrollIntoView({ block: 'start' }); true`
  );
}

/** Tags the first help button, outside the Rules group, to detect a full redraw. */
export async function markOutsideRules() {
  await evalJs(
    `${SETTINGS_DOC}.querySelector('.rollover-help-button').dataset.e2eMark = '1'; true`
  );
}

export async function markStillThere() {
  return evalJson(
    `Boolean(${SETTINGS_DOC}.querySelector('[data-e2e-mark="1"]')?.isConnected)`
  );
}

/** Types into the text field of the setting with this name. */
export async function setTextSetting(name, value) {
  const found = await evalJson(`(() => {
    const item = [...${SETTINGS_DOC}.querySelectorAll('.setting-item')].find(
      (s) => s.querySelector('.setting-item-name')?.textContent === ${JSON.stringify(
        name
      )});
    const input = item?.querySelector('input[type="text"], input:not([type])');
    if (!input) return false;
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!found) throw new Error(`No text setting named "${name}"`);
}

/** Clicks the button with exactly this text in the settings window's topmost dialog. */
export async function clickSettingsButton(text) {
  const clicked = await evalJson(`(() => {
    const modals = ${SETTINGS_DOC}.querySelectorAll('.modal');
    const top = modals[modals.length - 1];
    const button = [...(top?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent.trim() === ${JSON.stringify(text)});
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) {
    throw new Error(
      `No "${text}" button in the settings window's topmost dialog`
    );
  }
}

/** The open rule dialog's state, or null when none is open. */
export async function ruleDialog() {
  return evalJson(`(() => {
    const dialog = ${RULE_DIALOG};
    if (!dialog) return null;
    const problem = dialog.querySelector('.rollover-rule-problem');
    const save = [...dialog.closest('.modal').querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Save');
    const item = (name) =>
      [...dialog.querySelectorAll('.setting-item')]
        .find((s) => s.querySelector('.setting-item-name')?.textContent === name);
    const target = item('Target heading');
    return {
      fields: {
        match: item('Match')?.querySelector('select')?.value ?? null,
        value: item('Value')?.querySelector('input')?.value ?? null,
        effect: item('Effect')?.querySelector('select')?.value ?? null,
        target: target?.querySelector('input')?.value ?? null,
      },
      targetVisible: Boolean(target) && target.style.display !== 'none',
      problem: problem?.textContent ?? '',
      problemVisible: Boolean(problem) && problem.style.display !== 'none',
      saveDisabled: Boolean(save?.disabled || save?.classList.contains('is-disabled')),
    };
  })()`);
}

/** Sets the rule dialog's fields by their setting names. */
export async function fillRuleDialog({ match, value, effect, target }) {
  await waitFor(async () => (await ruleDialog()) !== null, {
    message: "the rule dialog",
  });
  const result = await evalJson(`(() => {
    const dialog = ${RULE_DIALOG};
    const field = (name, selector) =>
      [...dialog.querySelectorAll('.setting-item')]
        .find((s) => s.querySelector('.setting-item-name')?.textContent === name)
        ?.querySelector(selector);
    const set = (name, selector, v, event) => {
      if (v === undefined) return true;
      const el = field(name, selector);
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event(event, { bubbles: true }));
      return el.value === v;
    };
    return [
      set('Match', 'select', ${JSON.stringify(match)}, 'change'),
      set('Value', 'input', ${JSON.stringify(value)}, 'input'),
      set('Effect', 'select', ${JSON.stringify(effect)}, 'change'),
      set('Target heading', 'input', ${JSON.stringify(target)}, 'input'),
    ];
  })()`);
  if (!result?.every(Boolean)) {
    throw new Error(
      `Could not fill the rule dialog: ${JSON.stringify(result)}`
    );
  }
}
