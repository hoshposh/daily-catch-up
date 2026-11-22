// Look back in a real rollover: the daily notes of the last N days are read
// besides the previous one, within the window and from the start date, only
// when After rollover marks or deletes; what they show in the review, todos
// already done in a newer note, copies across notes, and undo.
import { afterEach, expect, test } from "vitest";
import {
  awaitAsync,
  evalJs,
  evalJson,
  startAsync,
  waitFor,
} from "./helpers/obsidian";
import {
  clickButton,
  notices,
  openToday,
  reviewRows,
  reviewSummary,
  runCommand,
  setOutcome,
  snapshotNotes,
  waitForIdle,
  waitForNotice,
  waitForReview,
} from "./helpers/rollover";
import { openSettings, setTextSetting } from "./helpers/settings-tab";
import {
  CHECKLIST_PROFILE,
  day,
  expectNoErrors,
  fixture,
  plugin,
  readNote,
  reset,
} from "./helpers/vault";

afterEach(expectNoErrors);

const TEMPLATE = fixture("daily-template.md");
const note = (offset) => `daily/${day(offset)}.md`;
const today = () => note(0);

/** CHECKLIST_PROFILE (Mark, Skip existing) with Look back at 7 days. */
const lookBack = (overrides = {}) => ({
  ...CHECKLIST_PROFILE,
  lookBackDays: 7,
  lookBackSince: day(-30),
  ...overrides,
});

/** A daily note holding these lines under ## Tasks. */
const tasks = (...lines) =>
  `## Tasks\n\n${lines.map((l) => `${l}\n`).join("")}`;

/** The template, today's note made from it, and `older` (path → content). */
const notesWith = (older, { withToday = true } = {}) => ({
  "templates/daily.md": TEMPLATE,
  ...(withToday ? { [today()]: TEMPLATE } : {}),
  ...older,
});

const HABIT_RULE = {
  id: "habit",
  enabled: true,
  match: "tag",
  value: "#habit",
  effect: "leave",
};

const lines = async (path) => (await readNote(path)).split("\n");

async function rollOver() {
  await runCommand("rollover");
  await waitForNotice("rolled over");
  await waitForIdle();
}

/**
 * The review's item labels per source: { name: [labels] }. With one source
 * the dialog has no "From …" rows; its name comes from the title.
 */
async function reviewGroups() {
  return evalJson(`(() => {
    const root = document.querySelector('.modal .rollover-review');
    if (!root) return null;
    const title = root.closest('.modal').querySelector('.modal-title')?.textContent ?? '';
    const groups = {};
    let current = title.startsWith('Roll over from ') ? title.slice('Roll over from '.length) : null;
    for (const item of root.querySelectorAll(':scope > .setting-item')) {
      const nameEl = item.querySelector('.setting-item-name');
      if (item.classList.contains('rollover-review-source')) {
        current = nameEl.textContent.replace(/^From /, '');
        continue;
      }
      if (!item.querySelector('select')) continue;
      const label = [...nameEl.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join('')
        .trim();
      (groups[current] ??= []).push(label);
    }
    return groups;
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

test("a todo stranded two notes back rolls and is marked", async () => {
  await reset({
    notes: notesWith({
      [note(-1)]: tasks("- [ ] Water plants"),
      [note(-3)]: tasks("- [ ] Pay rent"),
    }),
    settings: lookBack(),
  });

  await rollOver();

  const todayLines = await lines(today());
  expect(todayLines).toContain("- [ ] Pay rent");
  expect(todayLines).toContain("- [ ] Water plants");
  expect(await readNote(note(-3))).toBe(tasks("- [>] Pay rent"));
  expect(await readNote(note(-1))).toBe(tasks("- [>] Water plants"));
});

test("a late addition rolls and is deleted from its note under Delete", async () => {
  await reset({
    notes: notesWith({
      [note(-1)]: tasks("- [ ] Water plants"),
      [note(-3)]:
        "# Tuesday\n\n## Tasks\n\n- [x] Done already\n- [ ] Pay rent\n",
    }),
    settings: lookBack({ onRolloverSourceAction: "delete" }),
  });

  await rollOver();

  expect(await lines(today())).toContain("- [ ] Pay rent");
  const older = await readNote(note(-3));
  expect(older).not.toContain("Pay rent");
  expect(older).toContain("- [x] Done already");
});

test("a note just inside the window is read, one just outside is not", async () => {
  const outside = tasks("- [ ] Renew domain");
  await reset({
    notes: notesWith({
      [note(-1)]: tasks("- [ ] Water plants"),
      [note(-3)]: tasks("- [ ] Pay rent"),
      [note(-4)]: outside,
    }),
    settings: lookBack({ lookBackDays: 3 }),
  });

  await rollOver();

  const todayText = await readNote(today());
  expect(todayText.split("\n")).toContain("- [ ] Pay rent");
  expect(todayText).not.toContain("Renew domain");
  expect(await readNote(note(-3))).toBe(tasks("- [>] Pay rent"));
  expect(await readNote(note(-4))).toBe(outside);
});

test("notes dated before Read notes from are not read", async () => {
  const before = tasks("- [ ] Pay rent");
  await reset({
    notes: notesWith({
      [note(-1)]: tasks("- [ ] Water plants"),
      [note(-3)]: before,
    }),
    settings: lookBack({ lookBackSince: day(-2) }),
  });

  await rollOver();

  expect(await readNote(today())).not.toContain("Pay rent");
  expect(await readNote(note(-3))).toBe(before);
});

test("with After rollover set to leave them alone, older notes are not read", async () => {
  const older = tasks("- [ ] Pay rent");
  await reset({
    notes: notesWith({
      [note(-1)]: tasks("- [ ] Water plants"),
      [note(-3)]: older,
    }),
    settings: lookBack({ onRolloverSourceAction: "none" }),
  });

  await rollOver();

  const todayText = await readNote(today());
  expect(todayText.split("\n")).toContain("- [ ] Water plants");
  expect(todayText).not.toContain("Pay rent");
  expect(await readNote(note(-3))).toBe(older);
});

test("an empty start date becomes today and reads no older notes", async () => {
  const older = tasks("- [ ] Pay rent");
  await reset({
    notes: notesWith({
      [note(-1)]: tasks("- [ ] Water plants"),
      [note(-3)]: older,
    }),
    settings: lookBack({ lookBackSince: "" }),
  });

  await rollOver();

  expect(await readNote(today())).not.toContain("Pay rent");
  expect(await readNote(note(-3))).toBe(older);
  expect(await evalJson(`${plugin}.settings.lookBackSince`)).toBe(day());
  await startAsync(`return (await ${plugin}.loadData()).lookBackSince;`);
  expect(await awaitAsync()).toBe(day());
});

test("the review groups an older note and hides its rule-left todos", async () => {
  const habit = "- [ ] Exercise #habit";
  await reset({
    notes: notesWith({
      [note(-1)]: tasks("- [ ] Water plants"),
      [note(-2)]: tasks(habit),
      [note(-3)]: tasks("- [ ] Pay rent", habit),
    }),
    settings: lookBack({ rules: [HABIT_RULE] }),
  });

  await runCommand("review-and-rollover");
  await waitForReview();
  expect(await reviewGroups()).toEqual({
    [day(-1)]: ["Water plants"],
    [day(-3)]: ["Pay rent"],
  });
  expect(
    (await reviewRows()).filter((row) => row.label.includes("Exercise"))
  ).toEqual([]);
  // the hidden Leaves are not in the summary either
  expect(await reviewSummary()).toBe("2 roll");

  await clickButton("Apply");
  await waitForNotice("rolled over");
  await waitForIdle();

  expect(await readNote(today())).not.toContain("Exercise");
  expect(await readNote(note(-2))).toBe(tasks(habit));
  expect(await readNote(note(-3))).toBe(tasks("- [>] Pay rent", habit));
  // rule-left todos of older notes are not counted as left
  expect((await notices()).join("\n")).not.toContain("left in");
});

test("rule-left todos of older notes alone do not open the review", async () => {
  const habit = "- [ ] Exercise #habit";
  await reset({
    notes: notesWith(
      {
        [note(-1)]: tasks("- [x] Water plants", "- [x] Call Sam"),
        [note(-2)]: tasks(habit),
        [note(-3)]: tasks("- [ ] Call Sam", habit),
      },
      { withToday: false }
    ),
    settings: lookBack({ reviewOnAutoRollover: "always", rules: [HABIT_RULE] }),
  });

  await openToday();
  // the handled Call Sam shows the rollover ran, without a review
  await waitForNotice("already done in a newer note");
  await waitForIdle();

  expect(
    await evalJson("document.querySelectorAll('.modal-container').length")
  ).toBe(0);
  expect(await readNote(today())).toBe(TEMPLATE);
  expect(await readNote(note(-3))).toBe(tasks("- [>] Call Sam", habit));
  expect(await readNote(note(-2))).toBe(tasks(habit));
});

test.each(["mark", "delete"])(
  "%s: a rule-left todo done in a newer note stays put in its older note",
  async (action) => {
    const older = tasks("- [ ] Exercise #habit");
    await reset({
      notes: notesWith({
        [note(-1)]: tasks("- [ ] Water plants", "- [x] Exercise #habit"),
        [note(-3)]: older,
      }),
      settings: lookBack({
        onRolloverSourceAction: action,
        rules: [HABIT_RULE],
      }),
    });

    await rollOver();

    expect(await lines(today())).toContain("- [ ] Water plants");
    expect(await readNote(today())).not.toContain("Exercise");
    expect(await readNote(note(-3))).toBe(older);
  }
);

test("a todo left by hand is offered again by the next rollover", async () => {
  await reset({
    notes: notesWith({
      [note(-1)]: tasks("- [ ] Water plants"),
      [note(-3)]: tasks("- [ ] Pay rent"),
    }),
    settings: lookBack(),
  });

  await runCommand("review-and-rollover");
  await waitForReview();
  await setOutcome("Pay rent", "leave");
  await clickButton("Apply");
  await waitForNotice(`left in ${day(-3)}`);
  await waitForIdle();
  expect(await readNote(note(-3))).toBe(tasks("- [ ] Pay rent"));
  expect(await readNote(today())).not.toContain("Pay rent");

  // the next day's fresh note
  await startAsync(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(today())});
    await app.vault.modify(file, ${JSON.stringify(TEMPLATE)});
    return true;
  `);
  await awaitAsync();

  await runCommand("review-and-rollover");
  await waitForReview();
  expect(await reviewGroups()).toEqual({ [day(-3)]: ["Pay rent"] });
  await clickButton("Apply");
  await waitForIdle();
  expect(await lines(today())).toContain("- [ ] Pay rent");
});

test("a todo done in a newer note is not rolled and is marked", async () => {
  await reset({
    notes: notesWith({
      [note(-1)]: tasks("- [x] Call Sam"),
      [note(-3)]: tasks("- [ ] Call Sam"),
    }),
    settings: lookBack(),
  });

  await runCommand("rollover");
  await waitForNotice("already done in a newer note");
  await waitForIdle();

  expect(await readNote(today())).toBe(TEMPLATE);
  expect(await readNote(note(-3))).toBe(tasks("- [>] Call Sam"));
  expect(await readNote(note(-1))).toBe(tasks("- [x] Call Sam"));
});

test("copies across notes end up once in today's note, all marked", async () => {
  await reset({
    notes: notesWith({
      [note(-1)]: tasks("- [ ] Pay rent"),
      [note(-3)]: tasks("- [ ] Pay rent"),
    }),
    settings: lookBack(),
  });

  await rollOver();

  expect(
    (await lines(today())).filter((line) => line.includes("Pay rent"))
  ).toEqual(["- [ ] Pay rent"]);
  expect(await readNote(note(-1))).toBe(tasks("- [>] Pay rent"));
  expect(await readNote(note(-3))).toBe(tasks("- [>] Pay rent"));
});

test("undo restores today's note and every daily note the rollover changed", async () => {
  await reset({
    notes: notesWith({
      [note(-1)]: tasks("- [ ] Water plants"),
      [note(-3)]: tasks("- [ ] Pay rent"),
    }),
    settings: lookBack(),
  });
  const before = await snapshotNotes([today(), note(-1), note(-3)]);

  await rollOver();
  const after = await snapshotNotes([today(), note(-1), note(-3)]);
  for (const path of Object.keys(before)) {
    expect(after[path], path).not.toBe(before[path]);
  }

  await runCommand("undo-rollover");
  await waitForUndoDialog();
  await clickButton("Confirm Undo");
  await waitFor(
    async () =>
      JSON.stringify(await snapshotNotes([today(), note(-1), note(-3)])) ===
      JSON.stringify(before),
    { message: "today's note and both daily notes to be restored" }
  );
});

test("an earlier Read notes from set in the settings tab recovers a stranded todo", async () => {
  const stranded = tasks("- [ ] Pay rent");
  await reset({
    notes: notesWith({
      [note(-1)]: tasks("- [ ] Water plants"),
      [note(-5)]: stranded,
    }),
    // Look back turned on today: day -5 is before the start date
    settings: lookBack({ lookBackSince: day() }),
  });

  await openSettings();
  await setTextSetting("Read notes from", day(-10));
  await waitFor(
    async () => {
      await startAsync(`return (await ${plugin}.loadData())?.lookBackSince;`);
      return (await awaitAsync()) === day(-10);
    },
    { message: "Read notes from to be saved" }
  );
  await evalJs("app.setting.close(); true");

  await rollOver();

  expect(await lines(today())).toContain("- [ ] Pay rent");
  expect(await readNote(note(-5))).toBe(tasks("- [>] Pay rent"));
});
