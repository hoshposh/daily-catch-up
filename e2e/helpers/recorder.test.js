import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { removeTestOutput } from "./recorder";

describe("removeTestOutput", () => {
  let dir;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("removes the e2e- folders and keeps demos", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "demo-out-"));
    await mkdir(path.join(dir, "e2e-recorder", "frames"), { recursive: true });
    await writeFile(path.join(dir, "e2e-recorder", "frames", "f.png"), "x");
    await mkdir(path.join(dir, "e2e-pointer"));
    await mkdir(path.join(dir, "readme", "frames"), { recursive: true });
    await writeFile(path.join(dir, "readme.gif"), "gif");
    await writeFile(path.join(dir, "e2e-note.txt"), "a file, not a folder");

    await removeTestOutput(dir);

    expect((await readdir(dir)).sort()).toEqual([
      "e2e-note.txt",
      "readme",
      "readme.gif",
    ]);
  });

  test("a missing folder is fine", async () => {
    await expect(
      removeTestOutput(path.join(tmpdir(), "no-such-demo-out-dir"))
    ).resolves.toBeUndefined();
  });
});
