// Rollovers that are cancelled or refused must leave every note as it was.
import { afterEach, expect, test } from "vitest";
import {
  notices,
  openToday,
  pressEscape,
  runCommand,
  snapshotNotes,
  waitForIdle,
  waitForNotice,
  waitForReview,
  clickButton,
} from "./helpers/rollover";
import { evalJs, waitFor, evalJson } from "./helpers/obsidian";
import {
  CHECKLIST_PROFILE,
  day,
  expectNoErrors,
  fixture,
  readNote,
  reset,
  standardNotes,
} from "./helpers/vault";

const previous = () => `daily/${day(-1)}.md`;
const today = () => `daily/${day()}.md`;
const BACKLOG = "Backlog/Backlog.md";

afterEach(expectNoErrors);

test("escape on an automatic review skips the rollover", async () => {
  await reset({
    notes: standardNotes(),
    settings: { ...CHECKLIST_PROFILE, reviewOnAutoRollover: "always" },
  });
  const before = await snapshotNotes([previous()]);

  await openToday();
  await waitForReview();
  await pressEscape();
  await waitForNotice(
    "Rollover skipped. Run 'Review and roll over todos' when you're ready."
  );
  await waitForIdle();

  expect(await snapshotNotes([previous()])).toEqual(before);
  expect(await readNote(today())).toBe(fixture("daily-template.md"));
  expect(await readNote(BACKLOG)).toBeNull();
});

test("escape on a review command changes nothing and says nothing", async () => {
  await reset({
    notes: standardNotes({ withToday: true }),
    settings: { ...CHECKLIST_PROFILE, reviewOnAutoRollover: "always" },
  });
  const before = await snapshotNotes([previous(), today(), BACKLOG]);

  await runCommand("review-and-rollover");
  await waitForReview();
  await pressEscape();
  await waitForIdle();

  expect(await snapshotNotes([previous(), today(), BACKLOG])).toEqual(before);
  expect(await notices()).toEqual([]);
});

test("backlog note cannot be today's note", async () => {
  await reset({
    notes: standardNotes(),
    settings: { ...CHECKLIST_PROFILE, backlogNotePath: today() },
  });

  await openToday();
  await waitForNotice(
    "The backlog note can't be today's or the previous daily note. Change it in settings."
  );
  await waitForIdle();

  expect(await readNote(previous())).toBe(fixture("previous.md"));
  expect(await readNote(today())).toBe(fixture("daily-template.md"));
});

test("a second rollover waits for the open dialog", async () => {
  await reset({
    notes: standardNotes({ withToday: true }),
    settings: { ...CHECKLIST_PROFILE, reviewOnAutoRollover: "always" },
  });

  await runCommand("review-and-rollover");
  await waitForReview();
  await runCommand("rollover");
  await waitForNotice("A rollover is already in progress.");
  await clickButton("Apply");
  await waitForIdle();

  const lines = (await readNote(today())).split("\n");
  for (const todo of [
    "- [ ] Ship release",
    "- [ ] Write report",
    "- [ ] Fix flaky test",
    "- [ ] Plan trip",
  ]) {
    expect(
      lines.filter((line) => line.startsWith(todo)),
      todo
    ).toHaveLength(1);
  }
});

test("the recorder keeps short notices", async () => {
  await reset({ notes: standardNotes() });
  // gone in the same tick it appeared, before the test can read it (notice
  // timers and hide animations don't run while the window isn't in use, so
  // the element is removed directly)
  await evalJs(
    "const n = new Notice('flash').noticeEl; (n.closest('.notice') ?? n).remove(); true"
  );
  await waitFor(
    async () =>
      evalJson(
        "![...document.querySelectorAll('.notice')].some((n) => n.textContent === 'flash')"
      ),
    { message: "the notice to disappear" }
  );
  expect(await notices()).toContain("flash");
});
