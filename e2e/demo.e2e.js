// The demo runner leaves Obsidian as it found it, even when a demo fails.
import { afterEach, expect, test } from "vitest";
import { evalJson } from "./helpers/obsidian";
import { cleanupDemo, record } from "./helpers/demo";
import { pause } from "./helpers/pointer";
import { isRecording } from "./helpers/recorder";
import { expectNoErrors, reset, standardNotes } from "./helpers/vault";

afterEach(async () => {
  await cleanupDemo();
  await expectNoErrors();
});

const appState = () =>
  evalJson(`({
    size: [innerWidth, innerHeight],
    left: app.workspace.leftSplit.collapsed,
    right: app.workspace.rightSplit.collapsed,
    leftovers: document.querySelectorAll('#demo-pointer, #demo-pointer-style, #demo-no-blink, .demo-highlight').length,
    recorder: Boolean(window.__demoRecorder),
  })`);

const expectRestored = async (before) => {
  expect(await isRecording()).toBe(false);
  expect(await appState()).toEqual(before);
};

test("record() restores everything itself after a step fails", async () => {
  await reset({ notes: standardNotes() });
  const before = await appState();
  await expect(
    record(
      "e2e-cleanup",
      { width: 960, height: 600, collapsePanels: true },
      async () => {
        throw new Error("boom");
      }
    )
  ).rejects.toThrow("boom");
  await expectRestored(before);
});

test("record() reports a demo longer than maxMs and still restores everything", async () => {
  await reset({ notes: standardNotes() });
  const before = await appState();
  await expect(
    record(
      "e2e-cleanup",
      { width: 960, height: 600, collapsePanels: true, maxMs: 300 },
      () => pause(1500)
    )
  ).rejects.toThrow(/300 ms limit/);
  await expectRestored(before);
});

test("cleanupDemo is safe when nothing is running", async () => {
  await reset({ notes: standardNotes() });
  await cleanupDemo();
  expect(await isRecording()).toBe(false);
});
