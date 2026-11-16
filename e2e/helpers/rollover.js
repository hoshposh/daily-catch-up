// Drives a rollover the way a user does, and reads what it shows: the review
// dialog, the undo dialog and notices.
import { evalJs, evalJson, obsidian, waitFor } from "./obsidian";
import { ESCAPE_JS, day, plugin, readNote } from "./vault";

/**
 * Records the text of every notice as it appears, so a test can assert on a
 * notice that has already disappeared. Idempotent.
 */
export async function installNoticeRecorder() {
  await evalJs(`(() => {
    window.__e2eNoticeObserver?.disconnect();
    window.__e2eNotices = [];
    const seen = new WeakSet();
    const record = (el) => {
      if (seen.has(el)) return;
      seen.add(el);
      window.__e2eNotices.push(el.textContent);
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches(".notice")) record(node);
          node.querySelectorAll(".notice").forEach(record);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__e2eNoticeObserver = observer;
    return true;
  })()`);
}

export async function notices() {
  return (await evalJson("window.__e2eNotices ?? []")) ?? [];
}

export async function waitForNotice(substring) {
  return waitFor(
    async () => (await notices()).find((text) => text.includes(substring)),
    { message: `a notice containing ${JSON.stringify(substring)}` }
  );
}

/** An automatic run: creates today's note the way the user does. */
export async function openToday() {
  await obsidian(["daily"]);
  const path = `daily/${day()}.md`;
  await waitFor(
    async () =>
      evalJson(
        `Boolean(app.vault.getAbstractFileByPath(${JSON.stringify(path)}))`
      ),
    { message: `${path} to exist` }
  );
}

export async function runCommand(name) {
  await evalJs(`app.commands.executeCommandById('daily-catch-up:${name}')`);
}

/** Only meaningful once the run is known to have started. */
export async function waitForIdle() {
  await waitFor(
    async () =>
      evalJson(
        `${plugin}?.rolloverInProgress !== true && !document.querySelector('.rollover-review')`
      ),
    { message: "the rollover to finish", timeout: 20000 }
  );
}

const REVIEW_ROWS_JS = `(() => {
  const root = document.querySelector('.modal .rollover-review');
  if (!root) return null;
  const rows = [];
  let section = '';
  for (const item of root.querySelectorAll(':scope > .setting-item')) {
    const nameEl = item.querySelector('.setting-item-name');
    if (item.classList.contains('setting-item-heading')) {
      section = nameEl?.textContent ?? '';
      continue;
    }
    const select = item.querySelector('select');
    if (!select) continue;
    const label = [...nameEl.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join('')
      .trim();
    const badges = [...nameEl.querySelectorAll('.rollover-stale-badge, .rollover-rule-badge')]
      .filter((b) => b.style.display !== 'none')
      .map((b) => b.textContent);
    rows.push({ section, label, outcome: select.value, badges });
  }
  return rows;
})()`;

export async function reviewRows() {
  return evalJson(REVIEW_ROWS_JS);
}

export async function waitForReview() {
  return waitFor(
    async () => {
      const rows = await reviewRows();
      return rows && rows.length > 0 ? rows : null;
    },
    { message: "the review dialog", timeout: 15000 }
  );
}

export async function setOutcome(label, outcome) {
  const result = await evalJson(`(() => {
    const root = document.querySelector('.modal .rollover-review');
    const matches = [...root.querySelectorAll(':scope > .setting-item')].filter((item) => {
      const nameEl = item.querySelector('.setting-item-name');
      const text = [...(nameEl?.childNodes ?? [])].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      return text === ${JSON.stringify(label)} && item.querySelector('select');
    });
    if (matches.length !== 1) return matches.length;
    const select = matches[0].querySelector('select');
    select.value = ${JSON.stringify(outcome)};
    select.dispatchEvent(new Event('change'));
    return select.value === ${JSON.stringify(
      outcome
    )} ? 'ok' : 'no such outcome';
  })()`);
  if (result !== "ok") {
    throw new Error(
      `setOutcome(${JSON.stringify(label)}, ${outcome}): ${
        typeof result === "number" ? `${result} rows have that label` : result
      }`
    );
  }
}

export async function reviewSummary() {
  return evalJson(
    "document.querySelector('.rollover-review-summary')?.textContent ?? null"
  );
}

/** Clicks the button with exactly this text in the topmost dialog. */
export async function clickButton(text) {
  const clicked = await evalJson(`(() => {
    const modals = document.querySelectorAll('.modal');
    const top = modals[modals.length - 1];
    const button = [...(top?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === ${JSON.stringify(
      text
    )});
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) throw new Error(`No "${text}" button in the topmost dialog`);
}

export async function pressEscape() {
  await evalJs(ESCAPE_JS);
}

export async function snapshotNotes(paths) {
  const snapshot = {};
  for (const path of paths) snapshot[path] = await readNote(path);
  return snapshot;
}

/**
 * How far the element (or anything inside it) is wider than its box or runs
 * past the window's edges, in pixels; 0 when nothing overflows sideways.
 */
export async function horizontalOverflow(selector) {
  const result = await evalJson(`(() => {
    const root = document.querySelector(${JSON.stringify(selector)});
    if (!root) return null;
    let worst = 0;
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.clientWidth > 0) worst = Math.max(worst, el.scrollWidth - el.clientWidth);
    }
    const rect = root.getBoundingClientRect();
    return Math.max(worst, Math.ceil(rect.right - innerWidth), Math.ceil(-rect.left));
  })()`);
  if (result === null) throw new Error(`Nothing matches ${selector}`);
  return result;
}
