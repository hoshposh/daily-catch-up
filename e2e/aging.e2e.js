// Stale todos open the review by themselves, and the rollover counter goes
// before Obsidian Tasks fields and block ids (checklist check 4).
import { afterEach, expect, test } from "vitest";
import {
  clickButton,
  openToday,
  waitForIdle,
  waitForReview,
} from "./helpers/rollover";
import {
  CHECKLIST_PROFILE,
  day,
  expectNoErrors,
  fixture,
  readNote,
  reset,
  standardNotes,
} from "./helpers/vault";

const AGING = {
  ...CHECKLIST_PROFILE,
  onRolloverSourceAction: "none",
  trackRolloverCount: true,
  staleAfterRollovers: 2,
  reviewOnAutoRollover: "stale",
};

afterEach(expectNoErrors);

/** The lines indented under `head`, up to the next line that is not. */
function nestedUnder(lines, head) {
  const start = lines.indexOf(head);
  expect(start, head).toBeGreaterThan(-1);
  const nested = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    nested.push(line);
  }
  return nested;
}

test("stale todos open the review and counters go before Tasks fields", async () => {
  await reset({ notes: standardNotes(), settings: AGING });

  // an automatic run: nothing but the stale todo opens the dialog
  await openToday();
  const rows = await waitForReview();
  const flaky = rows.find((row) => row.label === "Fix flaky test");
  expect(flaky?.badges).toContain("rolled 2×");
  expect(rows.filter((row) => row.label.startsWith("Plan trip"))).toHaveLength(
    1
  );

  await clickButton("Apply");
  await waitForIdle();

  const lines = (await readNote(`daily/${day()}.md`)).split("\n");
  expect(lines).toContain("- [ ] Fix flaky test [rolled:: 3]");
  expect(lines).toContain("- [ ] Pay rent [rolled:: 1] 📅 2026-11-10");
  expect(lines).toContain("- [ ] Email Sam [rolled:: 1] ^email-sam");
  expect(lines).toContain("- [ ] Plan trip [rolled:: 1]");
  const children = nestedUnder(lines, "- [ ] Plan trip [rolled:: 1]");
  expect(children.length).toBeGreaterThan(0);
  expect(children.filter((line) => line.includes("[rolled::"))).toEqual([]);

  expect(await readNote(`daily/${day(-1)}.md`)).toBe(fixture("previous.md"));
  expect(await readNote("Backlog/Backlog.md")).toBeNull();
});

test("empty children are dropped with Remove empty todos on", async () => {
  await reset({
    notes: standardNotes(),
    settings: { ...AGING, removeEmptyTodos: true },
  });

  await openToday();
  const rows = await waitForReview();
  expect(rows.filter((row) => row.label.startsWith("Plan trip"))).toHaveLength(
    1
  );

  await clickButton("Apply");
  await waitForIdle();

  const lines = (await readNote(`daily/${day()}.md`)).split("\n");
  expect(nestedUnder(lines, "- [ ] Plan trip [rolled:: 1]")).toEqual([
    "  - [x] Book hotel",
    "  - [ ] Pack bags",
  ]);
});
