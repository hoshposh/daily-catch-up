// Runs one demo: prepares the window, records while `steps` drive Obsidian,
// and builds e2e/demos/out/<name>.gif. Demo files call cleanupDemo() in
// afterEach, so a failed demo leaves the app as it found it.
import { rmdir } from "node:fs/promises";
import path from "node:path";
import { assemble } from "./gif";
import {
  pause,
  prepareWindow,
  removePointer,
  restoreWindow,
  showPointer,
} from "./pointer";
import {
  OUT_DIR,
  resolveTarget,
  startRecording,
  stopRecording,
} from "./recorder";
import { closeModals } from "./vault";

/** How long the final state stays on screen before the recording stops. */
const HOLD_END_MS = 800;

export async function record(
  name,
  {
    target = "main",
    width,
    height,
    collapsePanels = false,
    outputWidth,
    maxBytes = null,
    fps,
  },
  steps
) {
  let dir;
  try {
    await resolveTarget(target);
    if (target === "main" && width) {
      await prepareWindow({ width, height, collapsePanels });
      // prepareWindow resolved the main window again
      await resolveTarget(target);
    }
    await showPointer();
    ({ dir } = await startRecording({ name, target, fps }));
    await steps();
    await pause(HOLD_END_MS);
    await stopRecording();
  } finally {
    await stopRecording();
    await removePointer();
    await restoreWindow();
  }
  const result = await assemble({
    dir,
    output: path.join(OUT_DIR, `${name}.gif`),
    width: outputWidth ?? width ?? 960,
    maxBytes,
  });
  // the frames folder is gone; its parent is empty unless frames were kept
  await rmdir(path.dirname(dir)).catch(() => {});
  return result;
}

/** Safe to call when nothing is running. */
export async function cleanupDemo() {
  await stopRecording();
  await removePointer();
  await restoreWindow();
  await closeModals();
}
