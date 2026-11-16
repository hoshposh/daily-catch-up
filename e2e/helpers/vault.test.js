import { describe, expect, test } from "vitest";
import { checkVaultSafe, day } from "./vault";

describe("checkVaultSafe", () => {
  test("checkVaultSafe accepts the marked vault", () => {
    expect(
      checkVaultSafe({
        name: "e2e-vault",
        entries: [".obsidian", "daily", ".e2e-vault"],
        hasMarker: true,
      })
    ).toBe("");
  });

  test("checkVaultSafe accepts a fresh vault", () => {
    expect(
      checkVaultSafe({
        name: "e2e-vault",
        entries: [".obsidian", "Welcome.md"],
        hasMarker: false,
      })
    ).toBe("");
  });

  test("checkVaultSafe refuses another vault", () => {
    expect(
      checkVaultSafe({
        name: "test-vault",
        entries: [".obsidian", ".e2e-vault"],
        hasMarker: true,
      })
    ).toContain("test-vault");
  });

  test("checkVaultSafe refuses an unmarked vault with notes", () => {
    const reason = checkVaultSafe({
      name: "e2e-vault",
      entries: [".obsidian", "Welcome.md", "Ideas.md"],
      hasMarker: false,
    });
    expect(reason).not.toBe("");
    expect(reason).toContain("e2e-vault");
  });
});

describe("day", () => {
  test("day counts in local days", () => {
    expect(day(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(day(-1) < day(0)).toBe(true);
    expect(day()).toBe(day(0));
  });
});
