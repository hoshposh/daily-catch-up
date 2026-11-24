// The four review outcomes, and undoing them (checklist checks 2 and 5).
import { afterEach, expect, test } from "vitest";
import { evalJs, evalJson, waitFor } from "./helpers/obsidian";
import {
  clickButton,
  notices,
  openToday,
  runCommand,
  setOutcome,
  waitForIdle,
  waitForNotice,
  waitForReview,
} from "./helpers/rollover";
import {
  CHECKLIST_PROFILE,
  day,
  expectNoErrors,
  plugin,
  fixture,
  readNote,
  reset,
  standardNotes,
} from "./helpers/vault";

const BACKLOG = "Backlog/Backlog.md";
const previous = () => `daily/${day(-1)}.md`;
const today = () => `daily/${day()}.md`;
const lineCount = (text) => text.split("\n").length;

afterEach(expectNoErrors);

// Shared by both tests: the reset before each test reloads the plugin, which
// clears the undo history.
async function rollWithFourOutcomes() {
  await reset({
    notes: standardNotes(),
    settings: {
      ...CHECKLIST_PROFILE,
      onRolloverSourceAction: "delete",
      backlogNotePath: BACKLOG,
      reviewOnAutoRollover: "always",
    },
  });
  const before = {
    [today()]: fixture("daily-template.md"),
    [previous()]: fixture("previous.md"),
    [BACKLOG]: null,
  };

  await openToday();
  await waitForReview();
  await setOutcome("Write report (+2 nested)", "roll");
  await setOutcome("Book flights", "backlog");
  await setOutcome("Renew domain", "cancel");
  await setOutcome("Call plumber", "leave");
  await clickButton("Apply");
  await waitForNotice("moved to backlog");
  await waitForIdle();
  return { before };
}

test("roll, backlog, cancel and leave", async () => {
  await rollWithFourOutcomes();

  const backlog = (await readNote(BACKLOG)).split("\n");
  expect(backlog).toContain(`- [ ] Book flights [from:: [[${day(-1)}]]]`);

  const todayLines = (await readNote(today())).split("\n");
  const report = todayLines.indexOf("- [ ] Write report");
  expect(report).toBeGreaterThan(-1);
  expect(todayLines.slice(report + 1, report + 3)).toEqual([
    "  - [x] Outline",
    "  - [ ] Draft",
  ]);
  for (const gone of ["Book flights", "Renew domain", "Call plumber"]) {
    expect(
      todayLines.filter((line) => line.includes(gone)),
      gone
    ).toEqual([]);
  }

  const previousLines = (await readNote(previous())).split("\n");
  expect(previousLines).toContain("- [-] Renew domain");
  expect(previousLines).toContain("- [ ] Call plumber");
  for (const gone of ["Write report", "Book flights"]) {
    expect(
      previousLines.filter((line) => line.includes(gone)),
      gone
    ).toEqual([]);
  }

  const summary = (await notices()).filter((text) =>
    text.includes("moved to backlog")
  );
  expect(summary).toHaveLength(1);
  expect(summary[0]).toContain("- 1 moved to backlog (Backlog/Backlog.md).");
  expect(summary[0]).toContain("- 1 cancelled.");
  expect(summary[0]).toContain(`- 1 left in ${day(-1)}.`);
});

test("undo restores both notes and deletes the new backlog note", async () => {
  const { before } = await rollWithFourOutcomes();
  const afterToday = await readNote(today());
  const afterPrevious = await readNote(previous());
  const added = lineCount(afterToday) - lineCount(before[today()]);
  const removed = lineCount(before[previous()]) - lineCount(afterPrevious);

  await runCommand("undo-rollover");
  const text = await waitFor(
    async () =>
      evalJson(`(() => {
        const modal = [...document.querySelectorAll('.modal')].find((m) =>
          [...m.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm Undo'));
        return modal && modal.textContent.includes('Backlog.md') ? modal.textContent : null;
      })()`),
    { message: "the undo dialog" }
  );
  expect(text).toContain(`- ${day()}.md: remove ${added} line`);
  expect(text).toContain(`- ${day(-1)}.md: add ${removed} line`);
  expect(text).toContain("- Backlog.md: will be deleted.");

  await clickButton("Confirm Undo");
  await waitFor(async () => (await readNote(today())) === before[today()], {
    message: "today's note to be restored",
  });
  await waitFor(
    async () => (await readNote(previous())) === before[previous()],
    { message: "the previous note to be restored" }
  );
  await waitFor(async () => (await readNote(BACKLOG)) === null, {
    message: "the backlog note to be deleted",
  });
});

test("a setting changed while the review is open waits for the next rollover", async () => {
  await reset({
    notes: standardNotes({ withToday: true }),
    settings: { templateHeading: "## Tasks" },
  });

  await runCommand("review-and-rollover");
  await waitForReview();
  // as if changed in the settings window while the dialog is open
  await evalJs(`${plugin}.settings.templateHeading = "## Nowhere"; true`);
  await clickButton("Apply");
  await waitForNotice("rolled over");
  await waitForIdle();

  expect(
    (await notices()).filter((text) => text.includes("couldn't find"))
  ).toEqual([]);
  const lines = (await readNote(today())).split("\n");
  expect(lines.indexOf("- [ ] Write report")).toBeGreaterThan(
    lines.indexOf("## Tasks")
  );
});
