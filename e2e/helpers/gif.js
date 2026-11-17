// Turns a folder of recorded frames into a GIF with ffmpeg, then shrinks it
// with gifsicle when that is installed.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { concatList, mergeRepeats, sizeProblem, withDurations } from "./frames";

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

/**
 * Builds `output` from the PNG frames and `frames.json` in `dir`
 * (`{ frames: {file, t}[], endT }`, files relative to `dir`). Repeated frames
 * are merged into one held frame. Deletes `dir` afterwards unless
 * `keepFrames` (or KEEP_FRAMES=1).
 */
export async function assemble({
  dir,
  output,
  width,
  maxBytes = null,
  keepFrames = process.env.KEEP_FRAMES === "1",
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

  if (!keepFrames) await rm(dir, { recursive: true, force: true });

  console.log(
    [
      `${output}: ${seconds.toFixed(1)} s, ${kept.length} frames, ${(
        bytes /
        1024 /
        1024
      ).toFixed(2)} MB`,
      ...warnings.map((w) => `  warning: ${w}`),
    ].join("\n")
  );
  return { output, bytes, seconds, frames: kept.length, warnings };
}
