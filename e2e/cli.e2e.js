import { expect, test } from "vitest";
import {
  awaitAsync,
  evalJs,
  evalJson,
  startAsync,
  waitFor,
} from "./helpers/obsidian";

test("evalJson round-trips awkward strings", async () => {
  expect(
    await evalJson('["a\\nb", "📅 2026-11-10", "q\\"uote", "tab\\tend"]')
  ).toEqual(["a\nb", "📅 2026-11-10", 'q"uote', "tab\tend"]);
});

test("evalJs surfaces errors", async () => {
  await expect(evalJs("throw new Error('boom')")).rejects.toThrow(/boom/);
});

test("startAsync waits for slow work", async () => {
  await startAsync("await new Promise(r => setTimeout(r, 1500)); return 7");
  expect(await awaitAsync()).toBe(7);
});

test("awaitAsync rethrows", async () => {
  await startAsync("throw new Error('late')");
  await expect(awaitAsync()).rejects.toThrow(/late/);
});

test("waitFor reports the last value", async () => {
  await expect(
    waitFor(async () => 0, { timeout: 300, message: "zero" })
  ).rejects.toThrow("Timed out waiting for zero; last value: 0");
});
