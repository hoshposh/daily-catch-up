import { readFileSync } from "node:fs";
import { lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  REPO_ROOT,
  capturedErrors,
  evalJs,
  evalJson,
  setMobile,
  setViewportWidth,
  waitFor,
} from "./helpers/obsidian";
import { runCommand, waitForReview } from "./helpers/rollover";
import {
  PLUGIN_ID,
  bootstrap,
  day,
  expectNoErrors,
  fixture,
  plugin,
  readNote,
  reset,
  standardNotes,
  vaultPath,
} from "./helpers/vault";

afterEach(expectNoErrors);

test("bootstrap loads this build", async () => {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "manifest.json"), "utf8")
  );
  expect(await evalJson(`${plugin}.manifest.version`)).toBe(manifest.version);
  expect(await evalJson(`Object.keys(${plugin}.settings)`)).toContain(
    "reviewOnAutoRollover"
  );
});

test("the plugin folder is not a symlink", async () => {
  const stat = await lstat(
    path.join(await vaultPath(), ".obsidian", "plugins", PLUGIN_ID)
  );
  expect(stat.isSymbolicLink()).toBe(false);
  expect(stat.isDirectory()).toBe(true);
});

test("reset writes notes and settings", async () => {
  await reset({
    notes: standardNotes(),
    settings: { templateHeading: "## Tasks" },
  });
  expect(await readNote(`daily/${day(-1)}.md`)).toBe(fixture("previous.md"));
  expect(await evalJson(`${plugin}.settings.templateHeading`)).toBe("## Tasks");
  expect(await evalJson(`${plugin}.settings.rolloverChildren`)).toBe(false);
});

test("reset starts clean after a failed test", async () => {
  await reset({ notes: standardNotes({ withToday: true }) });
  const fullWidth = await evalJson("innerWidth");
  // mobile emulation first: switching it reloads the app, which would close
  // everything opened before it
  await setMobile(true);
  await setViewportWidth(375);
  // a rollover left waiting in its review dialog
  await runCommand("review-and-rollover");
  await waitForReview();
  expect(await evalJson(`${plugin}.rolloverInProgress`)).toBe(true);
  // the palette next: it opens in the focused window, and the settings
  // window is a popout that takes focus
  await evalJs("app.commands.executeCommandById('command-palette:open')");
  await waitFor(
    async () =>
      (await evalJson(
        "document.querySelectorAll('.modal-container').length"
      )) === 2,
    { message: "the command palette to open over the review" }
  );
  await evalJs("app.setting.open()");
  await waitFor(async () => evalJson("app.setting.isOpen"), {
    message: "the settings window to open",
  });
  await evalJs("app.changeTheme('obsidian')");
  await writeFile(path.join(await vaultPath(), "Stray.md"), "stray\n");

  await reset({ notes: standardNotes() });

  expect(
    await evalJson("document.querySelectorAll('.modal-container').length")
  ).toBe(0);
  expect(await evalJson("app.setting.isOpen")).toBe(false);
  expect(await evalJson(`${plugin}.rolloverInProgress`)).toBe(false);
  expect(await evalJson("app.isMobile")).toBe(false);
  expect(await evalJson("innerWidth")).toBe(fullWidth);
  expect(
    await evalJson("document.body.classList.contains('theme-light')")
  ).toBe(true);
  expect(await readNote("Stray.md")).toBeNull();
});

test("expectNoErrors catches errors the plugin logs", async () => {
  await reset({ notes: standardNotes() });
  await evalJs("console.error('Daily Catch-Up: e2e logged error'); true");
  await expect(expectNoErrors()).rejects.toThrow(/e2e logged error/);
  // a reset starts the next test with a clean list
  await reset({ notes: standardNotes() });
});

test("bootstrap clears errors captured before the run", async () => {
  await evalJs(
    "setTimeout(() => { throw new Error('e2e stale error'); }, 0); true"
  );
  await waitFor(async () => (await capturedErrors()).length > 0, {
    message: "the stale error to be captured",
  });
  await bootstrap();
  expect(await capturedErrors()).toEqual([]);
});
