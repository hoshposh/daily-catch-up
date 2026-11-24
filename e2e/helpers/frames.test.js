import { expect, test } from "vitest";
import {
  concatList,
  mergeRepeats,
  sizeProblem,
  stillFrames,
  stillsList,
  withDurations,
} from "./frames";

const f = (file, t, key) => ({ file, t, key });

test("mergeRepeats keeps the first of each run of equal frames", () => {
  expect(
    mergeRepeats([
      f("a", 0, "1"),
      f("b", 100, "1"),
      f("c", 200, "2"),
      f("d", 300, "1"),
    ])
  ).toEqual([f("a", 0, "1"), f("c", 200, "2"), f("d", 300, "1")]);
});

test("mergeRepeats of no frames is no frames", () => {
  expect(mergeRepeats([])).toEqual([]);
});

test("withDurations holds each frame until the next, the last until the end", () => {
  expect(
    withDurations(
      [
        { file: "a", t: 0 },
        { file: "b", t: 2500 },
      ],
      3000
    )
  ).toEqual([
    { file: "a", duration: 2.5 },
    { file: "b", duration: 0.5 },
  ]);
});

test("withDurations never goes below 0.02 s", () => {
  const frames = withDurations(
    [
      { file: "a", t: 0 },
      { file: "b", t: 5 },
    ],
    6
  );
  expect(frames.map((x) => x.duration)).toEqual([0.02, 0.02]);
});

test("concatList repeats the last file so its duration is used", () => {
  expect(
    concatList([
      { file: "/x/a.png", duration: 1 },
      { file: "/x/b.png", duration: 0.5 },
    ])
  ).toBe(
    "ffconcat version 1.0\nfile '/x/a.png'\nduration 1\nfile '/x/b.png'\nduration 0.5\nfile '/x/b.png'\n"
  );
});

test("concatList escapes quotes in paths", () => {
  expect(concatList([{ file: "/it's here/a.png", duration: 1 }])).toContain(
    "file '/it'\\''s here/a.png'"
  );
});

test("sizeProblem is empty within the limit or without one", () => {
  expect(sizeProblem(1_000_000, 2_097_152)).toBe("");
  expect(sizeProblem(5_000_000, null)).toBe("");
});

test("sizeProblem names both sizes in MB when over the limit", () => {
  expect(sizeProblem(3_145_728, 2_097_152)).toMatch(
    /3\.0 MB.*over the 2\.0 MB limit/
  );
});

const d = (file, duration) => ({ file, duration });
const files = (frames) => frames.map((frame) => frame.file);

test("stillFrames keeps the frames held for a second or more, and the last", () => {
  expect(
    files(
      stillFrames([
        d("a", 0.1),
        d("b", 1.5),
        d("c", 0.2),
        d("d", 1),
        d("e", 0.3),
      ])
    )
  ).toEqual(["b", "d", "e"]);
});

test("stillFrames lists a held last frame once", () => {
  expect(files(stillFrames([d("a", 2), d("b", 1)]))).toEqual(["a", "b"]);
});

test("stillFrames keeps the longest-held up to max, in order, the last always", () => {
  expect(
    files(
      stillFrames([d("a", 3), d("b", 1), d("c", 5), d("d", 2), d("e", 0.1)], {
        max: 3,
      })
    )
  ).toEqual(["a", "c", "e"]);
});

test("stillFrames takes its own threshold", () => {
  expect(
    files(
      stillFrames([d("a", 0.5), d("b", 0.2), d("c", 0.1)], { minSeconds: 0.4 })
    )
  ).toEqual(["a", "c"]);
});

test("stillFrames of nothing is nothing", () => {
  expect(stillFrames([])).toEqual([]);
});

test("stillsList lists each file once, quoted", () => {
  expect(stillsList([d("/a/it's.png", 2), d("/a/b.png", 1)])).toBe(
    "ffconcat version 1.0\nfile '/a/it'\\''s.png'\nduration 1\nfile '/a/b.png'\nduration 1\n"
  );
});
