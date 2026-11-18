// The demo pointer and window sizing.
import { afterEach, expect, test } from "vitest";
import { evalJs, evalJson, waitFor } from "./helpers/obsidian";
import {
  highlight,
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

/**
 * The size the page really has. Electron's getContentSize() reports the size
 * it asked for; on Wayland a window behind others draws no frames, so the
 * resize only lands once something (here, a capture) makes it draw.
 */
export async function realSize() {
  for (let i = 0; i < 3; i++) {
    await evalJs(
      "require('@electron/remote').getCurrentWebContents().capturePage().then(() => true)"
    );
    await new Promise((r) => setTimeout(r, 200));
  }
  return evalJson("[innerWidth, innerHeight]");
}

const windowState = async () => ({
  size: await realSize(),
  ...(await evalJson(`(() => {
    const win = require('@electron/remote').getCurrentWindow();
    return {
      maximized: win.isMaximized(),
      left: app.workspace.leftSplit.collapsed,
      right: app.workspace.rightSplit.collapsed,
    };
  })()`)),
});

afterEach(async () => {
  await evalJson(
    "(document.querySelectorAll('.e2e-target').forEach((d) => d.remove()), true)"
  );
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
  // landed by the time restoreWindow returns, without a capture's help
  expect(await evalJson("[innerWidth, innerHeight]")).toEqual(before.size);
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

test("highlight covers each matching element, then removes itself", async () => {
  await reset({ notes: standardNotes() });
  await resolveTarget("main");
  await evalJson(`(() => {
    document.querySelectorAll('.e2e-target').forEach((d) => d.remove());
    for (const top of [100, 200]) {
      const d = document.body.createDiv({ cls: 'e2e-target' });
      d.style.cssText = 'position: fixed; left: 50px; width: 300px; height: 20px; top: ' + top + 'px;';
    }
    return true;
  })()`);
  expect(await highlight(".e2e-target", 600)).toBe(2);
  const boxes = await evalJson(`(() => {
    const at = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)]; };
    return {
      targets: [...document.querySelectorAll('.e2e-target')].map(at),
      highlights: [...document.querySelectorAll('.demo-highlight')].map(at),
    };
  })()`);
  expect(boxes.highlights).toEqual(boxes.targets);
  await waitFor(
    async () =>
      (await evalJson(
        "document.querySelectorAll('.demo-highlight').length"
      )) === 0,
    { message: "the highlights to go", timeout: 5000 }
  );
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
