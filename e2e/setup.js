// vitest globalSetup: prepares the e2e vault once per run, and afterwards
// checks that the repo-root main.js and data.json (the manual test vault's
// plugin, through its symlink) were not touched.
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  REPO_ROOT,
  SCREENSHOT_INDEX,
  assertAppReachable,
  setMobile,
  setViewportWidth,
} from "./helpers/obsidian";
import { bootstrap } from "./helpers/vault";

const GUARDED = ["main.js", "data.json"];

async function hashes() {
  const result = {};
  for (const file of GUARDED) {
    const data = await readFile(path.join(REPO_ROOT, file)).catch(() => null);
    result[file] = data
      ? createHash("sha256").update(data).digest("hex")
      : "absent";
  }
  return result;
}

let before;

export async function setup() {
  before = await hashes();
  await rm(SCREENSHOT_INDEX, { force: true });
  await bootstrap();
}

export async function teardown() {
  // leave the shared app as a person would want it, even when the last test
  // ran was the one in mobile mode (dev:mobile survives restarts). Only when
  // the app is running: a CLI call without it would launch Obsidian.
  if (
    await assertAppReachable().then(
      () => true,
      () => false
    )
  ) {
    await setViewportWidth(null);
    await setMobile(false);
  }
  const after = await hashes();
  for (const file of GUARDED) {
    if (before[file] !== after[file]) {
      throw new Error(
        `The suite changed ${file} in the repo root (the manual test vault's plugin).`
      );
    }
  }
  const index = await readFile(SCREENSHOT_INDEX, "utf8").catch(() => "");
  const shots = index.split("\n").filter(Boolean);
  if (shots.length > 0) {
    console.log(
      `\nScreenshots to review:\n${shots.map((s) => `  ${s}`).join("\n")}\n`
    );
  }
  await rm(SCREENSHOT_INDEX, { force: true });
}
