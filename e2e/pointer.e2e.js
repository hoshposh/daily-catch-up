// The demo pointer and window sizing.
import { afterEach, expect, test } from "vitest";
import { evalJson } from "./helpers/obsidian";
import {
  moveTo,
  prepareWindow,
  removePointer,
  restoreWindow,
  reviewSelect,
  showPointer,
} from "./helpers/pointer";
import {
  pressEscape,
  runCommand,
  waitForIdle,
  waitForReview,
} from "./helpers/rollover";
import {
  resolveTarget,
  startRecording,
  stopRecording,
} from "./helpers/recorder";
import { expectNoErrors, reset, standardNotes } from "./helpers/vault";

const windowState = () =>
  evalJson(`(() => {
    const win = require('@electron/remote').getCurrentWindow();
    return {
      content: win.getContentSize(),
      maximized: win.isMaximized(),
      left: app.workspace.leftSplit.collapsed,
      right: app.workspace.rightSplit.collapsed,
    };
  })()`);

afterEach(async () => {
  await stopRecording();
  await removePointer();
  await restoreWindow();
  await expectNoErrors();
});

test("prepareWindow sizes the window and restoreWindow puts it back", async () => {
  await reset({ notes: standardNotes() });
  const before = await windowState();
  await prepareWindow({ width: 960, height: 600, collapsePanels: true });
  expect(await evalJson("[innerWidth, innerHeight]")).toEqual([960, 600]);
  expect(await evalJson("app.workspace.leftSplit.collapsed")).toBe(true);
  expect(await evalJson("app.workspace.rightSplit.collapsed")).toBe(true);
  await restoreWindow();
  expect(await windowState()).toEqual(before);
});

test("restoreWindow does nothing when nothing was saved", async () => {
  await reset({ notes: standardNotes() });
  const before = await windowState();
  await restoreWindow();
  expect(await windowState()).toEqual(before);
});

// While Obsidian is behind other windows it draws no frames, so CSS
// transitions only run while something captures it. Demos move the pointer
// while recording, and so does this test.
test("the pointer moves to an element's centre while recording", async () => {
  await reset({ notes: standardNotes() });
  await resolveTarget("main");
  await showPointer();
  await startRecording({ name: "e2e-pointer" });
  const el = "window.__demoDoc.querySelector('.workspace-ribbon')";
  await moveTo(el);
  const [tip, centre] = await evalJson(`(() => {
    const p = window.__demoDoc.getElementById('demo-pointer').getBoundingClientRect();
    const r = (${el}).getBoundingClientRect();
    return [[p.left, p.top], [r.left + r.width / 2, r.top + r.height / 2]];
  })()`);
  expect(Math.abs(tip[0] - centre[0])).toBeLessThanOrEqual(2);
  expect(Math.abs(tip[1] - centre[1])).toBeLessThanOrEqual(2);
});

test("moveTo scrolls an element into view first", async () => {
  await reset({ notes: standardNotes({ withToday: true }) });
  await prepareWindow({ width: 960, height: 600 });
  await runCommand("review-and-rollover");
  await waitForReview();
  const el = reviewSelect("Call plumber");
  const visible = `(() => {
    const r = (${el}).getBoundingClientRect();
    const box = document.querySelector('.modal').getBoundingClientRect();
    return r.top >= box.top && r.bottom <= box.bottom;
  })()`;
  expect(await evalJson(visible)).toBe(false);
  await resolveTarget("main");
  await showPointer();
  await startRecording({ name: "e2e-pointer" });
  await moveTo(el);
  expect(await evalJson(visible)).toBe(true);
  await pressEscape();
  await waitForIdle();
});

test("removePointer leaves nothing behind", async () => {
  await reset({ notes: standardNotes() });
  await resolveTarget("main");
  await showPointer();
  await removePointer();
  expect(
    await evalJson(
      "document.querySelectorAll('#demo-pointer, .demo-ripple, #demo-pointer-style').length"
    )
  ).toBe(0);
});
