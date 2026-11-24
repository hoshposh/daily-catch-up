// Turns a folder of recorded frames into a GIF with ffmpeg, then shrinks it
// with gifsicle when that is installed.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  concatList,
  mergeRepeats,
  sizeProblem,
  stillFrames,
  stillsList,
  withDurations,
} from "./frames";

const run = promisify(execFile);

async function onPath(tool) {
  try {
    await run(tool, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function gifSeconds(file) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Number(stdout.trim());
}

/** The columns of the stills image: up to three side by side. */
const STILL_COLUMNS = 3;
const STILL_GAP = 8;

/**
 * Lays `stills` (from stillFrames()) out in a grid, each `stillWidth` wide,
 * in one PNG at `output`.
 */
async function writeStills(stills, dir, output, stillWidth) {
  const list = path.join(dir, "stills.txt");
  await writeFile(list, stillsList(stills));
  const columns = Math.min(STILL_COLUMNS, stills.length);
  const rows = Math.ceil(stills.length / columns);
  await run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    `scale=${stillWidth}:-1:flags=lanczos,tile=${columns}x${rows}:padding=${STILL_GAP}:margin=${STILL_GAP}:color=white`,
    "-frames:v",
    "1",
    output,
  ]);
}

/**
 * Builds `output` from the PNG frames and `frames.json` in `dir`
 * (`{ frames: {file, t}[], endT }`, files relative to `dir`). Repeated frames
 * are merged into one held frame. Also writes `<output>-stills.png` (the
 * `.gif` replaced): the moments the clip pauses on (stillFrames()), side by
 * side, each `stillWidth` wide, to check a clip at a glance. Deletes `dir`
 * afterwards unless `keepFrames` (or KEEP_FRAMES=1).
 */
export async function assemble({
  dir,
  output,
  width,
  maxBytes = null,
  keepFrames = process.env.KEEP_FRAMES === "1",
  stillWidth = 480,
}) {
  const { frames, endT } = JSON.parse(
    await readFile(path.join(dir, "frames.json"), "utf8")
  );
  const keyed = [];
  for (const frame of frames) {
    const file = path.join(dir, frame.file);
    const key = createHash("sha1")
      .update(await readFile(file))
      .digest("hex");
    keyed.push({ file, t: frame.t, key });
  }
  const kept = withDurations(mergeRepeats(keyed), endT);
  const list = path.join(dir, "concat.txt");
  await writeFile(list, concatList(kept));

  await mkdir(path.dirname(output), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    "-fps_mode",
    "vfr",
    output,
  ]);

  const warnings = [];
  if (await onPath("gifsicle")) {
    await run("gifsicle", ["-O3", "--batch", output]);
  } else {
    warnings.push("gifsicle not found; the GIF is not optimised");
  }

  const { size: bytes } = await stat(output);
  const tooBig = sizeProblem(bytes, maxBytes);
  if (tooBig) warnings.push(tooBig);
  const seconds = await gifSeconds(output);

  const stills = output.replace(/\.gif$/i, "") + "-stills.png";
  await writeStills(stillFrames(kept), dir, stills, stillWidth);

  if (!keepFrames) await rm(dir, { recursive: true, force: true });

  console.log(
    [
      `${output}: ${seconds.toFixed(1)} s, ${kept.length} frames, ${(
        bytes /
        1024 /
        1024
      ).toFixed(2)} MB`,
      `${stills}: the moments it pauses on`,
      ...warnings.map((w) => `  warning: ${w}`),
    ].join("\n")
  );
  return { output, stills, bytes, seconds, frames: kept.length, warnings };
}
