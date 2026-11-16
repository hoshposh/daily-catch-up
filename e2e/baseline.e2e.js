// With every feature added since main left off, a rollover writes exactly
// what main wrote. The expected files were generated from main's code with
// E2E_UPDATE_EXPECTED=1 and reviewed by hand before they were committed.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { REPO_ROOT } from "./helpers/obsidian";
import { openToday, waitForIdle, waitForNotice } from "./helpers/rollover";
import {
  CHECKLIST_PROFILE,
  day,
  expectNoErrors,
  readNote,
  reset,
  standardNotes,
} from "./helpers/vault";

const EXPECTED = path.join(REPO_ROOT, "e2e", "fixtures", "expected");

async function expectMatchesExpected(profile, name, actual) {
  const file = path.join(EXPECTED, profile, `${name}.md`);
  if (process.env.E2E_UPDATE_EXPECTED === "1") {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, actual);
    return;
  }
  if (!existsSync(file)) {
    throw new Error(
      `No expected output yet: generate it with E2E_UPDATE_EXPECTED=1 on main's code (see the plan, Task 4). Missing ${file}`
    );
  }
  expect(actual, `${profile}/${name}.md`).toBe(await readFile(file, "utf8"));
}

afterEach(expectNoErrors);

for (const [profile, settings] of [
  ["defaults", {}],
  ["checklist", CHECKLIST_PROFILE],
]) {
  test(`${
    profile === "defaults" ? "default" : "checklist"
  } settings`, async () => {
    await reset({ notes: standardNotes(), settings });

    await openToday();
    await waitForNotice("rolled over");
    await waitForIdle();

    await expectMatchesExpected(
      profile,
      "today",
      await readNote(`daily/${day()}.md`)
    );
    await expectMatchesExpected(
      profile,
      "previous",
      await readNote(`daily/${day(-1)}.md`)
    );
  });
}
