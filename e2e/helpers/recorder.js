// Records the e2e vault's own windows from inside Obsidian: a loop in the
// main window calls capturePage() on the target window about `fps` times a
// second and writes PNG frames. Windows are found only through this vault's
// documents, never picked from the app-wide window list, because one
// Obsidian app also runs the user's own vaults.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT, evalJs, evalJson, waitFor } from "./obsidian";
import { guardVault } from "./vault";

export const OUT_DIR = path.join(REPO_ROOT, "e2e", "demos", "out");

/**
 * Removes the folders the e2e tests record into (their names start with
 * "e2e-") from `outDir`, keeping demos and their GIFs. The e2e run's teardown
 * calls it, so a test's frames never outlive the run, passed or failed.
 */
export async function removeTestOutput(outDir = OUT_DIR) {
  const entries = await readdir(outDir, { withFileTypes: true }).catch(
    () => []
  );
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith("e2e-")) {
      await rm(path.join(outDir, entry.name), { recursive: true, force: true });
    }
  }
}

const NO_BLINK_ID = "demo-no-blink";

/**
 * Stores the target's BrowserWindow on window.__demoTarget and its document
 * on window.__demoDoc, or throws.
 */
export async function resolveTarget(target) {
  if (target === "main") {
    await evalJs(
      "window.__demoTarget = require('@electron/remote').getCurrentWindow(); window.__demoDoc = document; true"
    );
    return;
  }
  if (target !== "settings") throw new Error(`Unknown target "${target}"`);
  if (!(await evalJson("app.setting.isOpen === true"))) {
    throw new Error("The settings window is not open");
  }
  if (await evalJson("app.setting.modalEl.ownerDocument === document")) {
    // mobile layout: the settings are a dialog in the main window
    await evalJs(
      "window.__demoTarget = require('@electron/remote').getCurrentWindow(); window.__demoDoc = document; true"
    );
    return;
  }
  // Mark this vault's settings document with a one-off title, and take the
  // one window showing it.
  const token = `demo-target-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  await evalJs(`(() => {
    const doc = app.setting.modalEl.ownerDocument;
    window.__demoTitle = doc.title;
    doc.title = ${JSON.stringify(token)};
    return true;
  })()`);
  const matching = `require('@electron/remote').BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.getTitle() === ${JSON.stringify(
    token
  )})`;
  try {
    await waitFor(async () => (await evalJson(`${matching}.length`)) === 1, {
      message: "the settings window to show its marker title",
      timeout: 3000,
    });
    await evalJs(
      `window.__demoTarget = ${matching}[0]; window.__demoDoc = app.setting.modalEl.ownerDocument; true`
    );
  } catch {
    throw new Error("Could not find the settings window of this vault");
  } finally {
    await evalJs(
      "app.setting.modalEl.ownerDocument.title = window.__demoTitle; delete window.__demoTitle; true"
    );
  }
}

/** Starts recording `target` into OUT_DIR/<name>/frames, emptied first. */
export async function startRecording({
  name,
  target = "main",
  fps = 10,
  maxMs = 60000,
}) {
  await guardVault();
  if (await isRecording()) {
    throw new Error("A recording is already running");
  }
  // one that stopped on its own and was never collected (an interrupted run)
  await stopRecording().catch(() => {});
  await resolveTarget(target);
  if (
    await evalJson(
      "window.__demoTarget.isMinimized() || !window.__demoTarget.isVisible()"
    )
  ) {
    throw new Error(
      "The Obsidian window is minimised or hidden, so it can't be recorded. Bring it back and run again."
    );
  }
  const dir = path.join(OUT_DIR, name, "frames");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  await evalJs(`(() => {
    const doc = window.__demoDoc;
    if (!doc.getElementById('${NO_BLINK_ID}')) {
      const style = doc.createElement('style');
      style.id = '${NO_BLINK_ID}';
      style.textContent = '.cm-cursorLayer { animation: none !important; }';
      doc.head.appendChild(style);
    }
    // the loop runs in this window and captures the target: neither may be
    // slowed down while it is behind other windows
    const remote = require('@electron/remote');
    const contents = [...new Set([remote.getCurrentWebContents(), window.__demoTarget.webContents])];
    const throttling = contents.map((wc) => [wc, wc.getBackgroundThrottling()]);
    contents.forEach((wc) => wc.setBackgroundThrottling(false));

    const r = (window.__demoRecorder = {
      dir: ${JSON.stringify(dir)},
      running: true,
      stop: false,
      frames: [],
      error: null,
      timedOut: false,
      maxMs: ${maxMs},
      throttling,
      start: performance.now(),
    });
    (async () => {
      const fs = require('fs');
      const path = require('path');
      const wc = window.__demoTarget.webContents;
      try {
        while (!r.stop && performance.now() - r.start < ${maxMs}) {
          const began = performance.now();
          const image = await wc.capturePage();
          if (image.isEmpty()) {
            throw new Error('an empty frame: is the Obsidian window minimised or hidden?');
          }
          const file = 'frame-' + String(r.frames.length).padStart(6, '0') + '.png';
          await fs.promises.writeFile(path.join(r.dir, file), image.toPNG());
          r.frames.push({ file, t: Math.round(began - r.start) });
          const wait = Math.max(0, ${1000 / fps} - (performance.now() - began));
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
      } catch (e) {
        r.error = String(e?.message ?? e);
      }
      r.timedOut = !r.stop && r.error === null;
      r.endT = Math.round(performance.now() - r.start);
      r.running = false;
    })();
    return true;
  })()`);
  return { dir };
}

/** Whether the capture loop is still running. */
export async function isRecording() {
  return evalJson("window.__demoRecorder?.running === true");
}

/**
 * Stops the loop (or collects one that stopped itself), writes frames.json
 * and undoes what startRecording changed. Null when there is no recording.
 * Throws, after undoing, when capturing failed or the recording reached its
 * maxMs before this was called (its GIF would be missing the end).
 */
export async function stopRecording() {
  if (!(await evalJson("Boolean(window.__demoRecorder)"))) return null;
  await evalJs("window.__demoRecorder.stop = true; true");
  await waitFor(
    async () => evalJson("window.__demoRecorder.running === false"),
    { message: "the recorder to stop", timeout: 10000 }
  );
  const result = await evalJson(`(() => {
    const r = window.__demoRecorder;
    r.throttling.forEach(([wc, on]) => { if (!wc.isDestroyed()) wc.setBackgroundThrottling(on); });
    window.__demoDoc?.getElementById('${NO_BLINK_ID}')?.remove();
    delete window.__demoRecorder;
    return { dir: r.dir, frames: r.frames, endT: r.endT, error: r.error, timedOut: r.timedOut, maxMs: r.maxMs };
  })()`);
  if (result.error) throw new Error(`Recording failed: ${result.error}`);
  if (result.timedOut) {
    throw new Error(
      `The recording reached its ${result.maxMs} ms limit before the demo finished; pass a larger maxMs`
    );
  }
  const { dir, frames, endT } = result;
  await writeFile(
    path.join(dir, "frames.json"),
    JSON.stringify({ frames, endT }, null, 2)
  );
  return { dir, frames, endT };
}
