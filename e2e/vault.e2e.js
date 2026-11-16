import { readFileSync } from "node:fs";
import { lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  REPO_ROOT,
  evalJs,
  evalJson,
  setMobile,
  waitFor,
} from "./helpers/obsidian";
import {
  PLUGIN_ID,
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
  await reset({ notes: standardNotes() });
  // the palette first: it opens in the focused window, and the settings
  // window is a popout that takes focus
  await evalJs("app.commands.executeCommandById('command-palette:open')");
  await waitFor(
    async () =>
      (await evalJson(
        "document.querySelectorAll('.modal-container').length"
      )) === 1,
    { message: "the command palette to open" }
  );
  await evalJs("app.setting.open()");
  await waitFor(async () => evalJson("app.setting.isOpen"), {
    message: "the settings window to open",
  });
  await setMobile(true);
  await evalJs("app.changeTheme('obsidian')");
  await writeFile(path.join(await vaultPath(), "Stray.md"), "stray\n");

  await reset({ notes: standardNotes() });

  expect(
    await evalJson("document.querySelectorAll('.modal-container').length")
  ).toBe(0);
  expect(await evalJson("app.setting.isOpen")).toBe(false);
  expect(await evalJson("app.isMobile")).toBe(false);
  expect(
    await evalJson("document.body.classList.contains('theme-light')")
  ).toBe(true);
  expect(await readNote("Stray.md")).toBeNull();
});
