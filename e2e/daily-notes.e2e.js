// Which files count as daily notes, with Daily Notes settings other than the
// suite's usual `daily/YYYY-MM-DD`.
import { afterEach, expect, test } from "vitest";
import { awaitAsync, evalJs, startAsync } from "./helpers/obsidian";
import {
  runCommand,
  snapshotNotes,
  waitForIdle,
  waitForNotice,
} from "./helpers/rollover";
import {
  day,
  expectNoErrors,
  fixture,
  plugin,
  readNote,
  reset,
  standardNotes,
} from "./helpers/vault";

// the options bootstrap() gives the vault
const BOOTSTRAP_OPTIONS = {
  folder: "daily",
  format: "YYYY-MM-DD",
  template: "templates/daily",
};

/** Sets the core Daily Notes plugin's options, as bootstrap() does. */
async function setDailyOptions(options) {
  await evalJs(
    `(() => { app.internalPlugins.plugins["daily-notes"].instance.options = ${JSON.stringify(
      options
    )}; return true; })()`
  );
}

afterEach(expectNoErrors);
afterEach(() => setDailyOptions(BOOTSTRAP_OPTIONS));

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** journal/YYYY/MM/YYYY-MM-DD.md for a date */
const journalPath = (d) =>
  `journal/${d.getFullYear()}/${pad(d.getMonth() + 1)}/${ymd(d)}.md`;

test("a daily folder with brackets in its name", async () => {
  const folder = "Daily (work)";
  await reset({
    notes: {
      "templates/daily.md": fixture("daily-template.md"),
      [`${folder}/${day(-1)}.md`]: fixture("previous.md"),
      [`${folder}/${day()}.md`]: fixture("daily-template.md"),
    },
  });
  await setDailyOptions({ ...BOOTSTRAP_OPTIONS, folder });

  await runCommand("rollover");
  await waitForNotice("rolled over");
  await waitForIdle();

  expect((await readNote(`${folder}/${day()}.md`)).split("\n")).toContain(
    "- [ ] Ship release"
  );
});

test("a format with folders in it, across a month boundary", async () => {
  const now = new Date();
  // the last day of the previous month, in another MM folder
  const lastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const todayPath = journalPath(now);
  await reset({
    notes: {
      "templates/daily.md": fixture("daily-template.md"),
      [journalPath(lastMonth)]: fixture("previous.md"),
      [todayPath]: fixture("daily-template.md"),
    },
  });
  await setDailyOptions({
    ...BOOTSTRAP_OPTIONS,
    folder: "journal",
    format: "YYYY/MM/YYYY-MM-DD",
  });

  await runCommand("rollover");
  await waitForNotice("rolled over");
  await waitForIdle();

  expect((await readNote(todayPath)).split("\n")).toContain(
    "- [ ] Ship release"
  );
});

test("the command with a daily folder that does not exist", async () => {
  await reset({ notes: standardNotes({ withToday: true }) });
  await setDailyOptions({ ...BOOTSTRAP_OPTIONS, folder: "missing" });
  const paths = [`daily/${day(-1)}.md`, `daily/${day()}.md`];
  const before = await snapshotNotes(paths);

  // what "Roll over todos now" runs, awaited so the test sees it end
  await startAsync(`await ${plugin}.rollover(); return true;`);
  await expect(awaitAsync()).resolves.toBe(true);

  expect(await snapshotNotes(paths)).toEqual(before);
});
