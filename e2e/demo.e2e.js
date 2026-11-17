// The demo runner leaves Obsidian as it found it, even when a demo fails.
import { afterEach, expect, test } from "vitest";
import { evalJson } from "./helpers/obsidian";
import { cleanupDemo, record } from "./helpers/demo";
import { isRecording } from "./helpers/recorder";
import { expectNoErrors, reset, standardNotes } from "./helpers/vault";

afterEach(async () => {
  await cleanupDemo();
  await expectNoErrors();
});

test("cleanupDemo restores everything after a failed demo", async () => {
  await reset({ notes: standardNotes() });
  const before = await evalJson(
    "require('@electron/remote').getCurrentWindow().getContentSize()"
  );
  await expect(
    record(
      "e2e-cleanup",
      { width: 960, height: 600, collapsePanels: true },
      async () => {
        throw new Error("boom");
      }
    )
  ).rejects.toThrow("boom");
  await cleanupDemo();
  expect(await isRecording()).toBe(false);
  expect(
    await evalJson(
      "document.querySelectorAll('#demo-pointer, #demo-pointer-style, #demo-no-blink').length"
    )
  ).toBe(0);
  expect(await evalJson("Boolean(window.__demoRecorder)")).toBe(false);
  expect(
    await evalJson(
      "require('@electron/remote').getCurrentWindow().getContentSize()"
    )
  ).toEqual(before);
});

test("cleanupDemo is safe when nothing is running", async () => {
  await reset({ notes: standardNotes() });
  await cleanupDemo();
  expect(await isRecording()).toBe(false);
});
