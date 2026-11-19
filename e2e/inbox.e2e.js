// The inbox note as a second rollover source: drained on every rollover,
// grouped in the review, undoable, refused when it is another note the
// rollover uses, and left alone when it changes or cannot be written.
import { afterEach, expect, test } from "vitest";
import {
  awaitAsync,
  capturedErrors,
  clearErrors,
  evalJs,
  evalJson,
  startAsync,
  waitFor,
} from "./helpers/obsidian";
import {
  clickButton,
  notices,
  openToday,
  runCommand,
  setOutcome,
  snapshotNotes,
  waitForIdle,
  waitForNotice,
  waitForReview,
} from "./helpers/rollover";
import {
  day,
  expectNoErrors,
  fixture,
  readNote,
  reset,
  standardNotes,
} from "./helpers/vault";

const INBOX = "Inbox.md";
const INBOX_CONTENT = "## Captured\n\n- [ ] Buy milk\n- [ ] Call Sam\n";
const previous = () => `daily/${day(-1)}.md`;
const today = () => `daily/${day()}.md`;

const INBOX_GUARD =
  "The inbox note can't be today's note, the previous daily note or the backlog note. Change it in settings.";
const BACKLOG_GUARD =
  "The backlog note can't be today's or the previous daily note. Change it in settings.";
const INBOX_EDITED =
  "Rollover left the inbox note 'Inbox' unchanged: it was edited while the rollover was running. Its todos were still added to today's note; remove them from the inbox yourself.";
const INBOX_LOCKED =
  "Rollover couldn't write the inbox note 'Inbox' (locked), so it was left unchanged. Its todos were still added to today's note.";

afterEach(expectNoErrors);

/** standardNotes() plus the inbox note. */
const withInbox = (notes = standardNotes()) => ({
  ...notes,
  [INBOX]: INBOX_CONTENT,
});

const lines = async (path) => (await readNote(path)).split("\n");

/** The review dialog's title and its "From …" source rows. */
async function reviewHeader() {
  return evalJson(`(() => {
    const root = document.querySelector('.modal .rollover-review');
    if (!root) return null;
    return {
      title: root.closest('.modal').querySelector('.modal-title')?.textContent ?? '',
      sources: [...root.querySelectorAll('.rollover-review-source .setting-item-name')]
        .map((el) => el.textContent),
    };
  })()`);
}

async function waitForUndoDialog() {
  await waitFor(
    async () =>
      evalJson(
        `[...document.querySelectorAll('.modal button')].some((b) => b.textContent.trim() === 'Confirm Undo')`
      ),
    { message: "the undo dialog" }
  );
}

test("the morning rollover drains the inbox", async () => {
  await reset({
    notes: withInbox(),
    settings: { inboxNotePath: INBOX },
  });

  await openToday();
  await waitForNotice("rolled over");
  await waitForIdle();

  const todayLines = await lines(today());
  expect(todayLines).toContain("- [ ] Buy milk");
  expect(todayLines).toContain("- [ ] Call Sam");
  // the previous note's open todos came along too
  for (const todo of ["Ship release", "Write report", "Plan trip"]) {
    expect(
      todayLines.some((line) => line.startsWith(`- [ ] ${todo}`)),
      todo
    ).toBe(true);
  }

  const inbox = await readNote(INBOX);
  expect(inbox).toContain("## Captured");
  expect(inbox).not.toContain("Buy milk");
  expect(inbox).not.toContain("Call Sam");
});

test("the review shows each source, and Leave keeps an inbox todo", async () => {
  await reset({
    notes: withInbox(standardNotes({ withToday: true })),
    settings: { inboxNotePath: INBOX },
  });

  await runCommand("review-and-rollover");
  await waitForReview();
  expect(await reviewHeader()).toEqual({
    title: "Roll over todos",
    sources: [`From ${day(-1)}`, "From Inbox"],
  });

  await setOutcome("Call Sam", "leave");
  await clickButton("Apply");
  await waitForIdle();

  const inbox = await readNote(INBOX);
  expect(inbox.split("\n")).toContain("- [ ] Call Sam");
  expect(inbox).not.toContain("Buy milk");
  const todayLines = await lines(today());
  expect(todayLines).toContain("- [ ] Buy milk");
  expect(todayLines).not.toContain("- [ ] Call Sam");
});

test("undo restores the inbox", async () => {
  await reset({
    notes: withInbox(),
    settings: { inboxNotePath: INBOX },
  });

  await openToday();
  await waitForNotice("rolled over");
  await waitForIdle();
  expect(await readNote(INBOX)).not.toBe(INBOX_CONTENT);

  await runCommand("undo-rollover");
  await waitForUndoDialog();
  await clickButton("Confirm Undo");
  await waitFor(async () => (await readNote(INBOX)) === INBOX_CONTENT, {
    message: "the inbox note to be restored",
  });
  await waitFor(
    async () => (await readNote(today())) === fixture("daily-template.md"),
    { message: "today's note to be restored" }
  );
});

test("an inbox that is the backlog note stops the rollover", async () => {
  await reset({
    notes: withInbox(),
    settings: { inboxNotePath: INBOX, backlogNotePath: INBOX },
  });
  const before = await snapshotNotes([previous(), INBOX]);

  await openToday();
  await waitForNotice(INBOX_GUARD);
  await waitForIdle();

  expect(await notices()).not.toContain(BACKLOG_GUARD);
  expect(await snapshotNotes([previous(), INBOX])).toEqual(before);
  expect(await readNote(today())).toBe(fixture("daily-template.md"));
});

test("no previous note, inbox still drains", async () => {
  await reset({
    notes: withInbox({ "templates/daily.md": fixture("daily-template.md") }),
    settings: { inboxNotePath: INBOX },
  });
  // the CLI's `daily` cannot create the note without its folder, which a
  // vault that had daily notes before has
  await startAsync("await app.vault.createFolder('daily'); return true;");
  await awaitAsync();

  await openToday();
  await waitForNotice("rolled over");
  await waitForIdle();

  const todayLines = await lines(today());
  expect(todayLines).toContain("- [ ] Buy milk");
  expect(todayLines).toContain("- [ ] Call Sam");
  const inbox = await readNote(INBOX);
  expect(inbox).not.toContain("Buy milk");
  expect(inbox).not.toContain("Call Sam");
});

test("without an inbox note nothing changes", async () => {
  await reset({ notes: withInbox() });

  await openToday();
  await waitForNotice("rolled over");
  await waitForIdle();

  expect(await readNote(INBOX)).toBe(INBOX_CONTENT);
  const todayText = await readNote(today());
  expect(todayText).not.toContain("Buy milk");
  expect(todayText).not.toContain("Call Sam");
});

test("a capture during the review leaves the inbox alone", async () => {
  await reset({
    notes: withInbox(standardNotes({ withToday: true })),
    settings: { inboxNotePath: INBOX, onRolloverSourceAction: "delete" },
  });

  await runCommand("review-and-rollover");
  await waitForReview();
  // a capture arriving (from QuickAdd or a sync client) while the dialog is open
  await startAsync(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(INBOX)});
    await app.vault.process(file, (content) => content + '- [ ] New capture\\n');
    return true;
  `);
  await awaitAsync();
  await clickButton("Apply");
  await waitForNotice(INBOX_EDITED);
  await waitForIdle();

  const inbox = (await readNote(INBOX)).split("\n");
  for (const todo of ["Buy milk", "Call Sam", "New capture"]) {
    expect(inbox, todo).toContain(`- [ ] ${todo}`);
  }
  const todayLines = await lines(today());
  expect(todayLines).toContain("- [ ] Buy milk");
  expect(todayLines).toContain("- [ ] Call Sam");
  // the previous note was not edited, so its delete still ran
  const previousText = await readNote(previous());
  expect(previousText).not.toContain("Write report");
  expect(previousText).not.toContain("Plan trip");
});

test("a failed inbox write keeps the rollover undoable", async () => {
  await reset({
    notes: withInbox(standardNotes({ withToday: true })),
    settings: { inboxNotePath: INBOX, onRolloverSourceAction: "delete" },
  });
  const before = await snapshotNotes([previous(), today()]);

  await runCommand("review-and-rollover");
  await waitForReview();
  try {
    // keep the original only once: a run killed before its finally leaves
    // the wrapper in place, which must not be kept as the original
    await evalJs(`(() => {
      if (!window.__e2eProcess) window.__e2eProcess = app.vault.process;
      app.vault.process = function (file, fn, options) {
        if (file?.path === ${JSON.stringify(INBOX)}) {
          return Promise.reject(new Error('locked'));
        }
        return window.__e2eProcess.call(this, file, fn, options);
      };
      return true;
    })()`);
    await clickButton("Apply");
    await waitForNotice(INBOX_LOCKED);
    await waitForIdle();
  } finally {
    // the app keeps the patch until it reloads, and reset() does not undo it
    await evalJs(
      "if (window.__e2eProcess) { app.vault.process = window.__e2eProcess; delete window.__e2eProcess; } true"
    );
  }

  const errors = await capturedErrors();
  expect(errors.join("\n")).toContain(
    "Daily Catch-Up: could not write the source note"
  );
  expect(errors.join("\n")).toContain("locked");
  // logged on purpose; afterEach must not count it
  await clearErrors();

  expect(await readNote(INBOX)).toBe(INBOX_CONTENT);
  const todayLines = await lines(today());
  expect(todayLines).toContain("- [ ] Buy milk");
  expect(todayLines).toContain("- [ ] Call Sam");
  const previousText = await readNote(previous());
  expect(previousText).not.toContain("Write report");

  await runCommand("undo-rollover");
  await waitForUndoDialog();
  await clickButton("Confirm Undo");
  await waitFor(async () => (await readNote(today())) === before[today()], {
    message: "today's note to be restored",
  });
  await waitFor(
    async () => (await readNote(previous())) === before[previous()],
    { message: "the previous note to be restored" }
  );
  expect(await readNote(INBOX)).toBe(INBOX_CONTENT);
});
