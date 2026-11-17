import { expect, test } from "vitest";
import { concatList, mergeRepeats, sizeProblem, withDurations } from "./frames";

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
