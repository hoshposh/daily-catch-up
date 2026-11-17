// The in-app recorder: frames of the e2e vault's own windows, and nothing
// else. Meant to pass while Obsidian is behind other windows, as it usually
// is while the suite runs.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { evalJs, evalJson, waitFor } from "./helpers/obsidian";
import {
  OUT_DIR,
  isRecording,
  startRecording,
  stopRecording,
} from "./helpers/recorder";
import { openSettings } from "./helpers/settings-tab";
import { expectNoErrors, reset, standardNotes } from "./helpers/vault";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (file) =>
  createHash("sha1").update(readFileSync(file)).digest("hex");

/** Width and height from a PNG's header. */
function pngSize(file) {
  const data = readFileSync(file);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

afterEach(async () => {
  await stopRecording();
  await evalJs("document.querySelector('.e2e-red')?.remove(); true");
  await expectNoErrors();
});

test("captures a change made while recording", async () => {
  await reset({ notes: standardNotes() });
  const { dir } = await startRecording({ name: "e2e-recorder" });
  await sleep(500);
  await evalJs(
    "(() => { const d = document.body.createDiv({ cls: 'e2e-red' }); d.style.cssText = 'position: fixed; inset: 0; background: red; z-index: 99999;'; return true; })()"
  );
  await sleep(500);
  await evalJs("document.querySelector('.e2e-red').remove(); true");
  const { frames } = await stopRecording();
  expect(frames.length).toBeGreaterThanOrEqual(5);
  const first = sha1(path.join(dir, frames[0].file));
  expect(frames.some((f) => sha1(path.join(dir, f.file)) !== first)).toBe(true);
});

test("starts from an empty frames folder", async () => {
  await reset({ notes: standardNotes() });
  await startRecording({ name: "e2e-recorder" });
  await sleep(800);
  await stopRecording();
  const { dir } = await startRecording({ name: "e2e-recorder" });
  await sleep(300);
  const { frames } = await stopRecording();
  const pngs = readdirSync(dir).filter((f) => f.endsWith(".png"));
  expect(pngs.sort()).toEqual(frames.map((f) => f.file).sort());
  const listed = JSON.parse(
    readFileSync(path.join(dir, "frames.json"), "utf8")
  );
  expect(listed.frames).toEqual(frames);
});

test("stops on its own after maxMs", async () => {
  await reset({ notes: standardNotes() });
  await startRecording({ name: "e2e-recorder", maxMs: 500 });
  await waitFor(async () => !(await isRecording()), {
    message: "the recorder to stop itself",
    timeout: 5000,
  });
});

test("records the settings window", async () => {
  await reset({ notes: standardNotes() });
  await openSettings();
  const { dir } = await startRecording({
    name: "e2e-recorder",
    target: "settings",
  });
  await sleep(400);
  const { frames } = await stopRecording();
  expect(frames.length).toBeGreaterThan(0);
  const expected = await evalJson(`(() => {
    const remote = require('@electron/remote');
    const size = (win) => {
      const [w, h] = win.getContentSize();
      const sf = remote.screen.getDisplayMatching(win.getBounds()).scaleFactor;
      return { width: Math.round(w * sf), height: Math.round(h * sf) };
    };
    return { settings: size(window.__demoTarget), main: size(remote.getCurrentWindow()) };
  })()`);
  expect(expected.settings).not.toEqual(expected.main);
  const actual = pngSize(path.join(dir, frames[0].file));
  expect(Math.abs(actual.width - expected.settings.width)).toBeLessThanOrEqual(
    2
  );
  expect(
    Math.abs(actual.height - expected.settings.height)
  ).toBeLessThanOrEqual(2);
});

test("refuses to record settings when the settings window is closed", async () => {
  await reset({ notes: standardNotes() });
  const dir = path.join(OUT_DIR, "e2e-refused", "frames");
  await expect(
    startRecording({ name: "e2e-refused", target: "settings" })
  ).rejects.toThrow(/settings window is not open/);
  expect(existsSync(dir)).toBe(false);
  expect(await isRecording()).toBe(false);
});
