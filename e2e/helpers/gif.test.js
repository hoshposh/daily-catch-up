import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test } from "vitest";
import { assemble } from "./gif";

const run = promisify(execFile);

function onPath(tool) {
  try {
    execFileSync(tool, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// CI has no ffmpeg
const noFfmpeg = !onPath("ffmpeg");

let tmp;
let dir;

async function frame(name, colour) {
  await run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${colour}:s=64x48`,
    "-frames:v",
    "1",
    path.join(dir, name),
  ]);
}

beforeEach(async () => {
  // a quote and a space in the path, as a worktree or demo name might have
  tmp = await mkdtemp(path.join(os.tmpdir(), "demo gif's-"));
  dir = path.join(tmp, "frames");
  if (noFfmpeg) return;
  await run("mkdir", ["-p", dir]);
  await frame("frame-000000.png", "red");
  await frame("frame-000001.png", "blue");
  await frame("frame-000002.png", "blue");
  await writeFile(
    path.join(dir, "frames.json"),
    JSON.stringify({
      frames: [
        { file: "frame-000000.png", t: 0 },
        { file: "frame-000001.png", t: 1000 },
        { file: "frame-000002.png", t: 1500 },
      ],
      endT: 2000,
    })
  );
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test.skipIf(noFfmpeg)(
  "assemble merges repeats, scales and cleans up",
  async () => {
    const output = path.join(tmp, "out.gif");
    const result = await assemble({ dir, output, width: 32 });
    expect(existsSync(output)).toBe(true);
    expect(result.frames).toBe(2);
    expect(result.seconds).toBeCloseTo(2, 1);
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=width",
      "-of",
      "csv=p=0",
      output,
    ]);
    expect(stdout.trim()).toBe("32");
    expect(existsSync(dir)).toBe(false);
  }
);

test.skipIf(noFfmpeg)(
  "assemble warns when the GIF is over maxBytes",
  async () => {
    const output = path.join(tmp, "out.gif");
    const result = await assemble({ dir, output, width: 32, maxBytes: 10 });
    expect(result.warnings.filter((w) => /over the/.test(w))).toHaveLength(1);
  }
);

test.skipIf(noFfmpeg)("assemble keeps the frames when asked", async () => {
  const output = path.join(tmp, "out.gif");
  await assemble({ dir, output, width: 32, keepFrames: true });
  expect(existsSync(path.join(dir, "frame-000000.png"))).toBe(true);
});

test.skipIf(noFfmpeg)(
  "assemble lays the held frames out in a stills image beside the GIF",
  async () => {
    const output = path.join(tmp, "out.gif");
    const result = await assemble({ dir, output, width: 32, stillWidth: 16 });
    // red and blue are each on screen for a second: two 16 x 12 stills side
    // by side, 8 px apart and 8 px from the edges
    expect(result.stills).toBe(path.join(tmp, "out-stills.png"));
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      result.stills,
    ]);
    expect(stdout.trim()).toBe("56,28");
    // built before the frames were deleted
    expect(existsSync(dir)).toBe(false);
  }
);

test.skipIf(noFfmpeg)(
  "a stills grid that isn't full is still written",
  async () => {
    // four held frames: three columns, two rows, two cells empty
    const colours = ["red", "green", "blue", "yellow"];
    for (const [i, colour] of colours.entries()) {
      await frame(`frame-00001${i}.png`, colour);
    }
    await writeFile(
      path.join(dir, "frames.json"),
      JSON.stringify({
        frames: colours.map((_, i) => ({
          file: `frame-00001${i}.png`,
          t: i * 1000,
        })),
        endT: 4000,
      })
    );
    const output = path.join(tmp, "out.gif");
    const result = await assemble({ dir, output, width: 32, stillWidth: 16 });
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      result.stills,
    ]);
    expect(stdout.trim()).toBe("80,48");
  }
);
