// Bring back from backlog: the command, its dialog (everything on Stay, "from"
// badges), what reaches today's note and what stays in the backlog, undo, the
// notices for a missing note, and a backlog edited while the dialog is open.
import { afterEach, expect, test } from "vitest";
import {
  awaitAsync,
  evalJson,
  screenshot,
  setViewportWidth,
  startAsync,
  waitFor,
} from "./helpers/obsidian";
import {
  clickButton,
  horizontalOverflow,
  notices,
  pressEscape,
  reviewRows,
  reviewSummary,
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
  readNote,
  reset,
  standardNotes,
} from "./helpers/vault";

const BACKLOG = "Backlog.md";
const BACKLOG_CONTENT =
  "## Someday\n\n- [ ] Learn Rust [from:: [[2026-11-01]]]\n- [ ] Fix bike [from:: [[2026-11-02]]]\n- [ ] Read Dune [from:: [[2026-11-03]]]\n";
const SETTINGS = { backlogNotePath: BACKLOG, templateHeading: "## Tasks" };
const today = () => `daily/${day()}.md`;

const BACKLOG_EDITED =
  "Bring back left the backlog note 'Backlog' unchanged: it was edited while the dialog was open. Its todos were still added to today's note; remove them from the backlog yourself.";

afterEach(expectNoErrors);

const withBacklog = (content = BACKLOG_CONTENT) => ({
  ...standardNotes({ withToday: true }),
  [BACKLOG]: content,
});

const lines = async (path) => (await readNote(path)).split("\n");

async function openBringBack() {
  await runCommand("bring-back-from-backlog");
  return waitForReview();
}

const dialogTitle = () =>
  evalJson(
    "document.querySelector('.modal .rollover-review')?.closest('.modal').querySelector('.modal-title')?.textContent ?? null"
  );

async function waitForUndoDialog() {
  await waitFor(
    async () =>
      evalJson(
        `[...document.querySelectorAll('.modal button')].some((b) => b.textContent.trim() === 'Confirm Undo')`
      ),
    { message: "the undo dialog" }
  );
}

test("only offered with a backlog note", async () => {
  const available = () =>
    evalJson(
      "app.commands.findCommand('daily-catch-up:bring-back-from-backlog').checkCallback(true)"
    );
  await reset({ notes: withBacklog(), settings: { backlogNotePath: "" } });
  expect(await available()).toBe(false);
  await reset({ notes: withBacklog(), settings: SETTINGS });
  expect(await available()).toBe(true);
});

test("brings back the chosen todos", async () => {
  await reset({ notes: withBacklog(), settings: SETTINGS });

  const rows = await openBringBack();
  expect(await dialogTitle()).toBe("Bring back from Backlog");
  expect(rows.map((row) => row.label)).toEqual([
    "Learn Rust",
    "Fix bike",
    "Read Dune",
  ]);
  expect(rows.map((row) => row.outcome)).toEqual(["leave", "leave", "leave"]);
  expect(rows.map((row) => row.badges)).toEqual([
    ["from 2026-11-01"],
    ["from 2026-11-02"],
    ["from 2026-11-03"],
  ]);

  await setOutcome("Learn Rust", "roll");
  await setOutcome("Read Dune", "roll");
  expect(await reviewSummary()).toBe("2 to bring back, 1 stay");
  await clickButton("Apply");
  await waitForNotice("Brought back 2 todos from Backlog.");
  await waitForIdle();

  const todayLines = await lines(today());
  const tasks = todayLines.indexOf("## Tasks");
  expect(todayLines.indexOf("- [ ] Learn Rust")).toBeGreaterThan(tasks);
  expect(todayLines.indexOf("- [ ] Read Dune")).toBeGreaterThan(tasks);
  expect(todayLines.join("\n")).not.toContain("[from::");
  expect(await readNote(BACKLOG)).toBe(
    "## Someday\n\n- [ ] Fix bike [from:: [[2026-11-02]]]\n"
  );
});

test("a Not a todo regex does not see the from link", async () => {
  const dates = {
    id: "dates",
    enabled: true,
    match: "regex",
    value: String.raw`\d{4}-\d{2}-\d{2}`,
    effect: "ignore",
  };
  await reset({
    notes: withBacklog(),
    settings: { ...SETTINGS, rules: [dates] },
  });

  const rows = await openBringBack();
  expect(rows.map((row) => row.label)).toEqual([
    "Learn Rust",
    "Fix bike",
    "Read Dune",
  ]);
  await pressEscape();
  await waitForIdle();
});

test("cancel marks in the backlog", async () => {
  await reset({ notes: withBacklog(), settings: SETTINGS });

  await openBringBack();
  await setOutcome("Fix bike", "cancel");
  await clickButton("Apply");
  await waitForNotice("- 1 cancelled.");
  await waitForIdle();

  expect(await lines(BACKLOG)).toContain(
    "- [-] Fix bike [from:: [[2026-11-02]]]"
  );
});

test("nothing chosen changes nothing", async () => {
  await reset({ notes: withBacklog(), settings: SETTINGS });
  const before = await snapshotNotes([today(), BACKLOG]);

  await openBringBack();
  await clickButton("Apply");
  await waitForNotice("Nothing brought back.");
  await waitForIdle();

  expect(await snapshotNotes([today(), BACKLOG])).toEqual(before);
});

test("closing the dialog changes nothing", async () => {
  await reset({ notes: withBacklog(), settings: SETTINGS });
  const before = await snapshotNotes([today(), BACKLOG]);

  await openBringBack();
  await pressEscape();
  await waitForIdle();

  expect(await snapshotNotes([today(), BACKLOG])).toEqual(before);
  expect(
    (await notices()).filter((text) => text.includes("Brought back"))
  ).toEqual([]);
});

test("undo puts both notes back", async () => {
  await reset({ notes: withBacklog(), settings: SETTINGS });
  const before = await snapshotNotes([today(), BACKLOG]);

  await openBringBack();
  await setOutcome("Learn Rust", "roll");
  await clickButton("Apply");
  await waitForNotice("Brought back 1 todo from Backlog.");
  await waitForIdle();
  expect(await readNote(BACKLOG)).not.toContain("Learn Rust");

  await runCommand("undo-rollover");
  await waitForUndoDialog();
  expect(
    await evalJson(
      "[...document.querySelectorAll('.modal')].some((m) => m.textContent.includes('Undoing a bring back'))"
    )
  ).toBe(true);
  await clickButton("Confirm Undo");
  await waitFor(
    async () =>
      JSON.stringify(await snapshotNotes([today(), BACKLOG])) ===
      JSON.stringify(before),
    { message: "both notes restored" }
  );
});

test("undo after a Cancel-only bring back says today's note stays", async () => {
  await reset({ notes: withBacklog(), settings: SETTINGS });

  await openBringBack();
  await setOutcome("Fix bike", "cancel");
  await clickButton("Apply");
  await waitForNotice("- 1 cancelled.");
  await waitForIdle();

  await runCommand("undo-rollover");
  await waitForUndoDialog();
  const text = await evalJson(
    "[...document.querySelectorAll('.modal')].map((m) => m.textContent).join('\\n')"
  );
  expect(text).toContain("Today's note will not be changed.");
  expect(text).not.toContain("rolled over todos");
  await clickButton("Confirm Undo");
  await waitFor(async () => (await readNote(BACKLOG)) === BACKLOG_CONTENT, {
    message: "the backlog restored",
  });
});

test("without today's note it only says so", async () => {
  await reset({
    notes: { ...standardNotes(), [BACKLOG]: BACKLOG_CONTENT },
    settings: SETTINGS,
  });

  await runCommand("bring-back-from-backlog");
  await waitForNotice(
    "Create today's daily note first, then bring todos back."
  );
  expect(
    await evalJson(
      `Boolean(app.vault.getAbstractFileByPath(${JSON.stringify(today())}))`
    )
  ).toBe(false);
  expect(await readNote(BACKLOG)).toBe(BACKLOG_CONTENT);
});

test("a missing or empty backlog only says so", async () => {
  await reset({
    notes: standardNotes({ withToday: true }),
    settings: SETTINGS,
  });
  await runCommand("bring-back-from-backlog");
  await waitForNotice("There is no backlog note at 'Backlog.md' yet.");

  await reset({ notes: withBacklog("## Someday\n"), settings: SETTINGS });
  await runCommand("bring-back-from-backlog");
  await waitForNotice("The backlog note 'Backlog' has no open todos.");
});

test("a backlog edited during the dialog is left alone", async () => {
  await reset({ notes: withBacklog(), settings: SETTINGS });

  await openBringBack();
  await startAsync(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(BACKLOG)});
    await app.vault.process(file, (content) => content + '- [ ] New idea\\n');
    return true;
  `);
  await awaitAsync();
  await setOutcome("Learn Rust", "roll");
  await clickButton("Apply");
  await waitForNotice(BACKLOG_EDITED);
  await waitForIdle();

  expect(await lines(today())).toContain("- [ ] Learn Rust");
  const backlog = await lines(BACKLOG);
  for (const todo of ["Learn Rust", "Fix bike", "Read Dune"]) {
    expect(
      backlog.some((line) => line.startsWith(`- [ ] ${todo}`)),
      todo
    ).toBe(true);
  }
  expect(backlog).toContain("- [ ] New idea");
});

test("a parked todo comes back as it was", async () => {
  await reset({
    notes: standardNotes({ withToday: true }),
    settings: { ...SETTINGS, onRolloverSourceAction: "delete" },
  });

  await runCommand("review-and-rollover");
  await waitForReview();
  await setOutcome("Write report", "backlog");
  await clickButton("Apply");
  await waitForNotice("moved to backlog");
  await waitForIdle();
  expect(await readNote(BACKLOG)).toContain("Write report [from:: [[");

  await openBringBack();
  await setOutcome("Write report", "roll");
  await clickButton("Apply");
  await waitForNotice("Brought back 1 todo from Backlog.");
  await waitForIdle();

  const reports = (await lines(today())).filter((line) =>
    line.includes("Write report")
  );
  expect(reports).toEqual(["- [ ] Write report"]);
  expect(await readNote(BACKLOG)).not.toContain("Write report");
});

// last: the narrow viewport stays until the suite's teardown
test("the dialog fits a phone", async () => {
  await reset({ notes: withBacklog(), settings: SETTINGS });
  await setViewportWidth(375);
  expect(await evalJson("innerWidth")).toBe(375);

  await openBringBack();
  expect(await horizontalOverflow(".modal")).toBe(0);
  await screenshot("bring-back-phone");

  await pressEscape();
  await waitForIdle();
  await setViewportWidth(null);
});
