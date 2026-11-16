// Guards, bootstraps and resets the e2e vault. Writes only inside the vault the
// CLI resolves for VAULT_NAME, and only once checkVaultSafe() has passed.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  REPO_ROOT,
  VAULT_NAME,
  clearErrors,
  capturedErrors,
  evalJs,
  evalJson,
  obsidian,
  setMobile,
  startAsync,
  awaitAsync,
  waitFor,
} from "./obsidian";
import { installNoticeRecorder } from "./rollover";

export const MARKER = ".e2e-vault";
export const PLUGIN_ID = "daily-catch-up";
export const plugin = `app.plugins.plugins['${PLUGIN_ID}']`;
const FRESH_ENTRIES = [".obsidian", "Welcome.md"];
const KEEP_ENTRIES = [".obsidian", MARKER];
const FIXTURES = path.join(REPO_ROOT, "e2e", "fixtures", "notes");

export const CHECKLIST_PROFILE = {
  onRolloverSourceAction: "mark",
  rolloverSourceMarker: ">",
  moveNestedItemsOnMark: true,
  skipExistingTodos: true,
  ignoreBlockquotes: true,
  rolloverChildren: true,
  templateHeading: "## Tasks",
};

/** "" when the suite may write to this vault, otherwise the reason it may not. */
export function checkVaultSafe({ name, entries, hasMarker }) {
  if (name !== VAULT_NAME) {
    return `The CLI resolved vault "${name}", not "${VAULT_NAME}". The e2e suite only writes to "${VAULT_NAME}".`;
  }
  if (hasMarker) return "";
  const extra = entries.filter((entry) => !FRESH_ENTRIES.includes(entry));
  if (extra.length === 0) return "";
  return `Vault "${name}" has no ${MARKER} marker and already holds ${extra.join(
    ", "
  )}. The e2e suite only adopts an empty vault; use a new, empty vault named "${VAULT_NAME}".`;
}

/** Local date as YYYY-MM-DD, offset by whole days. */
export function day(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fixture(name) {
  return readFileSync(path.join(FIXTURES, name), "utf8");
}

export function standardNotes({ previous = day(-1), withToday = false } = {}) {
  const template = fixture("daily-template.md");
  return {
    "templates/daily.md": template,
    [`daily/${previous}.md`]: fixture("previous.md"),
    ...(withToday ? { [`daily/${day()}.md`]: template } : {}),
  };
}

let checkedPath = null;

export async function vaultPath() {
  return obsidian(["vault", "info=path"]);
}

/** Resolves and checks the vault; adopts a fresh one by writing the marker. */
export async function guardVault() {
  if (checkedPath) return checkedPath;
  const dir = await vaultPath();
  const name = await obsidian(["vault", "info=name"]);
  const entries = await readdir(dir);
  const reason = checkVaultSafe({
    name,
    entries,
    hasMarker: entries.includes(MARKER),
  });
  if (reason) throw new Error(reason);
  if (!entries.includes(MARKER)) {
    await writeFile(
      path.join(dir, MARKER),
      "This vault belongs to the Daily Catch-Up e2e tests. Its notes are deleted on every run.\n"
    );
  }
  checkedPath = dir;
  return dir;
}

const pluginDir = (dir) => path.join(dir, ".obsidian", "plugins", PLUGIN_ID);

async function waitForPlugin(loaded) {
  await waitFor(
    async () =>
      (await evalJson(`Boolean(${plugin}?._loaded)`)) === loaded ? true : null,
    { message: `the plugin to be ${loaded ? "loaded" : "unloaded"}` }
  );
}

/** Builds this checkout's plugin into the vault and enables it. */
export async function bootstrap() {
  const dir = await guardVault();
  const target = pluginDir(dir);
  const existing = await lstat(target).catch(() => null);
  if (existing?.isSymbolicLink()) {
    throw new Error(
      `${target} is a symlink. The e2e vault needs its own copy of the plugin; remove the link.`
    );
  }
  await mkdir(target, { recursive: true });
  await promisify(execFile)(
    path.join(REPO_ROOT, "node_modules", ".bin", "rollup"),
    [
      "-c",
      "--environment",
      "BUILD:production",
      "--file",
      path.join(target, "main.js"),
    ],
    { cwd: REPO_ROOT }
  );
  for (const file of ["manifest.json", "styles.css"]) {
    await copyFile(path.join(REPO_ROOT, file), path.join(target, file));
  }

  const dailyOptions = {
    folder: "daily",
    format: "YYYY-MM-DD",
    template: "templates/daily",
  };
  await writeFile(
    path.join(dir, ".obsidian", "daily-notes.json"),
    JSON.stringify(dailyOptions, null, 2)
  );
  await evalJs(
    `(() => { const p = app.internalPlugins.plugins["daily-notes"]; if (!p.enabled) p.enable(); p.instance.options = ${JSON.stringify(
      dailyOptions
    )}; return true; })()`
  );

  await obsidian(["plugins:restrict", "off"]);
  await evalJs("app.plugins.loadManifests().then(() => true)");
  await waitFor(
    async () => evalJson(`Boolean(app.plugins.manifests['${PLUGIN_ID}'])`),
    { message: "Obsidian to see the plugin's manifest" }
  );
  if (!(await evalJson(`Boolean(${plugin}?._loaded)`))) {
    await obsidian(["plugin:enable", `id=${PLUGIN_ID}`, "filter=community"]);
  } else {
    await obsidian(["plugin:reload", `id=${PLUGIN_ID}`]);
  }
  await waitForPlugin(true);
}

/** Dispatches Escape where Obsidian's keymap hears it (the focused element). */
export const ESCAPE_JS = `(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }))`;

/**
 * Closes every open dialog: the settings window (a popout window in
 * Obsidian 1.15, so not in this document) through app.setting, and dialogs
 * in the main window with Escape, top one first.
 */
export async function closeModals() {
  await waitFor(
    async () => {
      const left = await evalJson(
        `(() => { if (app.setting.isOpen) app.setting.close(); const n = document.querySelectorAll('.modal-container').length; if (n > 0) ${ESCAPE_JS}; return n + (app.setting.isOpen ? 1 : 0); })()`
      );
      return left === 0;
    },
    { message: "dialogs to close", interval: 200 }
  );
}

async function vaultFiles() {
  return evalJson("app.vault.getFiles().map(f => f.path).sort()");
}

/**
 * Puts the vault in a known state: no dialogs, desktop mode, light theme,
 * exactly `notes`, and the plugin restarted with `rawData ?? settings` as its
 * data.json (the plugin merges its own defaults over what is missing).
 */
export async function reset({ notes, settings = {}, rawData } = {}) {
  const dir = await guardVault();
  await closeModals();
  await setMobile(false);
  await evalJs("app.changeTheme('moonstone')");
  // earlier tests' notices (their timers may not run in an unused window)
  await evalJs(
    "document.querySelectorAll('.notice').forEach((n) => n.remove()); true"
  );
  await waitFor(
    async () =>
      (await evalJson(`${plugin}?.rolloverInProgress === true`)) === false,
    { message: "the previous rollover to end", timeout: 15000 }
  );

  // the plugin is off while notes are written, so writing today's note does
  // not start a rollover
  // (it may already be off, when an earlier reset failed halfway)
  if (await evalJson(`Boolean(${plugin}?._loaded)`)) {
    await obsidian(["plugin:disable", `id=${PLUGIN_ID}`, "filter=community"]);
  }
  await waitForPlugin(false);

  // Delete through Obsidian, with the editors closed: deleting on disk and
  // recreating the same folder at once can slip past its file watcher,
  // leaving a deleted note in app.vault (and an open tab writing it back).
  await startAsync(`
    app.workspace.getLeavesOfType('markdown').forEach((leaf) => leaf.detach());
    for (const child of [...app.vault.getRoot().children]) {
      await app.vault.delete(child, true);
    }
    return true;
  `);
  await awaitAsync();
  for (const entry of await readdir(dir)) {
    if (!KEEP_ENTRIES.includes(entry)) {
      await rm(path.join(dir, entry), { recursive: true, force: true });
    }
  }
  for (const [notePath, content] of Object.entries(notes ?? {})) {
    const file = path.join(dir, notePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  const expected = JSON.stringify(Object.keys(notes ?? {}).sort());
  await waitFor(
    async () => {
      const actual = JSON.stringify(await vaultFiles());
      if (actual !== expected) throw new Error(`the vault holds ${actual}`);
      return true;
    },
    { message: `the vault to hold exactly ${expected}` }
  );

  await writeFile(
    path.join(pluginDir(dir), "data.json"),
    JSON.stringify(rawData ?? settings, null, 2)
  );
  await obsidian(["plugin:enable", `id=${PLUGIN_ID}`, "filter=community"]);
  await waitForPlugin(true);
  await clearErrors();
  await installNoticeRecorder();
}

/** A note's text, or null when it does not exist. */
export async function readNote(notePath) {
  const dir = await guardVault();
  return readFile(path.join(dir, notePath), "utf8").catch((e) =>
    e.code === "ENOENT" ? null : Promise.reject(e)
  );
}

export async function expectNoErrors() {
  const errors = await capturedErrors();
  if (errors.length > 0) {
    throw new Error(`Obsidian captured errors:\n${errors.join("\n")}`);
  }
}
