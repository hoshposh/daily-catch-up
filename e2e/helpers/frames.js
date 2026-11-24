// Pure helpers for turning recorded frames into a GIF: which frames to keep,
// how long each stays on screen, and ffmpeg's input list. No imports from the
// other helpers, which load the Obsidian CLI.

/** Shortest frame time: GIF delays are whole hundredths, and many viewers ignore less. */
const MIN_SECONDS = 0.02;

/** Drops each frame whose `key` equals the previous kept frame's `key`. */
export function mergeRepeats(frames) {
  const kept = [];
  for (const frame of frames) {
    if (kept.length === 0 || kept[kept.length - 1].key !== frame.key) {
      kept.push(frame);
    }
  }
  return kept;
}

/**
 * Each frame's time on screen in seconds: until the next frame, and the last
 * one until `endT` (all times in ms).
 */
export function withDurations(frames, endT) {
  return frames.map((frame, i) => {
    const until = i + 1 < frames.length ? frames[i + 1].t : endT;
    const seconds = Math.round(until - frame.t) / 1000;
    return { file: frame.file, duration: Math.max(MIN_SECONDS, seconds) };
  });
}

/**
 * The moments a clip pauses on, for a still image beside the GIF: the frames
 * (from withDurations()) on screen for at least `minSeconds`, and always the
 * last one, the final state. With more than `max`, the last and the longest
 * held of the rest are kept. In clip order.
 */
export function stillFrames(frames, { minSeconds = 1, max = 12 } = {}) {
  if (frames.length === 0) return [];
  const last = frames.length - 1;
  const held = frames
    .map((frame, i) => ({ frame, i }))
    .filter(({ frame, i }) => i !== last && frame.duration >= minSeconds);
  const kept = held
    .sort((a, b) => b.frame.duration - a.frame.duration || a.i - b.i)
    .slice(0, Math.max(0, max - 1))
    .map(({ i }) => i);
  return [...kept, last].sort((a, b) => a - b).map((i) => frames[i]);
}

/** A path quoted for ffmpeg's concat demuxer: ' becomes '\''. */
const quote = (file) => `'${file.replaceAll("'", "'\\''")}'`;

/**
 * ffmpeg concat-demuxer input. The last file is listed again, because the
 * demuxer ignores the duration of the final entry otherwise.
 */
export function concatList(frames) {
  const lines = ["ffconcat version 1.0"];
  for (const { file, duration } of frames) {
    lines.push(`file ${quote(file)}`, `duration ${duration}`);
  }
  if (frames.length > 0) {
    lines.push(`file ${quote(frames[frames.length - 1].file)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** ffmpeg concat-demuxer input for the stills image: each file once. */
export function stillsList(frames) {
  const lines = ["ffconcat version 1.0"];
  for (const { file } of frames)
    lines.push(`file ${quote(file)}`, "duration 1");
  return `${lines.join("\n")}\n`;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** "" when `bytes` is within `maxBytes` (or there is no limit), otherwise why not. */
export function sizeProblem(bytes, maxBytes) {
  if (maxBytes == null || bytes <= maxBytes) return "";
  return `The GIF is ${mb(bytes)}, over the ${mb(maxBytes)} limit`;
}
