import { describe, expect, test } from "vitest";
import {
  isValidDay,
  lookBackApplies,
  lookBackDependenciesMet,
  nextLookBackSince,
  parseLookBackDays,
  parseLookBackSince,
  settledLookBackSince,
} from "./look-back";

const on = {
  onRolloverSourceAction: "mark",
  skipExistingTodos: true,
  lookBackDays: 7,
};
const TODAY = "2026-11-21";

describe("lookBackApplies", () => {
  test("true with Mark or Delete, Skip existing and days", () => {
    expect(lookBackApplies(on)).toBe(true);
    expect(lookBackApplies({ ...on, onRolloverSourceAction: "delete" })).toBe(
      true
    );
  });
  test("false without a destructive or marking action", () => {
    expect(lookBackApplies({ ...on, onRolloverSourceAction: "none" })).toBe(
      false
    );
    expect(lookBackApplies({ ...on, onRolloverSourceAction: undefined })).toBe(
      false
    );
  });
  test("false without Skip existing todos", () => {
    expect(lookBackApplies({ ...on, skipExistingTodos: false })).toBe(false);
  });
  test("false for 0, missing or non-integer days", () => {
    expect(lookBackApplies({ ...on, lookBackDays: 0 })).toBe(false);
    expect(lookBackApplies({ ...on, lookBackDays: undefined })).toBe(false);
    expect(lookBackApplies({ ...on, lookBackDays: "7" })).toBe(false);
    expect(lookBackApplies({ ...on, lookBackDays: 1.5 })).toBe(false);
  });
  test("dependencies are met whatever the days", () => {
    expect(lookBackDependenciesMet({ ...on, lookBackDays: 0 })).toBe(true);
    expect(lookBackDependenciesMet({ ...on, skipExistingTodos: false })).toBe(
      false
    );
  });
});

describe("nextLookBackSince", () => {
  const stored = { ...on, lookBackSince: "2026-10-01" };
  const off = { ...stored, lookBackDays: 0 };
  test("off to on starts today", () => {
    expect(
      nextLookBackSince({ wasApplying: false, settings: on, today: TODAY })
    ).toBe("2026-11-21");
  });
  test("on to off clears it", () => {
    expect(
      nextLookBackSince({ wasApplying: true, settings: off, today: TODAY })
    ).toBe("");
  });
  test("on to on keeps it", () => {
    expect(
      nextLookBackSince({ wasApplying: true, settings: stored, today: TODAY })
    ).toBe("2026-10-01");
  });
  test("off to off keeps what is stored", () => {
    expect(
      nextLookBackSince({ wasApplying: false, settings: off, today: TODAY })
    ).toBe("2026-10-01");
    expect(
      nextLookBackSince({
        wasApplying: false,
        settings: { lookBackDays: 0 },
        today: TODAY,
      })
    ).toBe("");
  });
});

describe("settledLookBackSince", () => {
  test.each(["", "2026-13-40", "yesterday", undefined])(
    "applying with %j starts today",
    (lookBackSince) => {
      expect(settledLookBackSince({ ...on, lookBackSince }, TODAY)).toEqual({
        since: "2026-11-21",
        changed: true,
      });
    }
  );
  test("applying with a valid day changes nothing", () => {
    expect(
      settledLookBackSince({ ...on, lookBackSince: "2026-10-01" }, TODAY)
    ).toEqual({ since: "2026-10-01", changed: false });
  });
  test("not applying changes nothing", () => {
    expect(
      settledLookBackSince({ ...on, lookBackDays: 0, lookBackSince: "" }, TODAY)
    ).toEqual({ since: "", changed: false });
  });
});

test("isValidDay", () => {
  expect(isValidDay("2026-02-28")).toBe(true);
  expect(isValidDay("2026-02-30")).toBe(false);
  expect(isValidDay("2026-1-5")).toBe(false);
  expect(isValidDay(undefined)).toBe(false);
  expect(isValidDay("2024-02-29")).toBe(true);
});

test("parseLookBackDays", () => {
  expect(parseLookBackDays("7")).toBe(7);
  expect(parseLookBackDays(" 0 ")).toBe(0);
  expect(parseLookBackDays("366")).toBe(366);
  for (const bad of ["367", "-1", "1.5", "abc", ""]) {
    expect(parseLookBackDays(bad), bad).toBeUndefined();
  }
});

test("parseLookBackSince", () => {
  expect(parseLookBackSince("", TODAY)).toBe("2026-11-21");
  expect(parseLookBackSince(" 2026-11-01 ", TODAY)).toBe("2026-11-01");
  expect(parseLookBackSince("2026-11-21", TODAY)).toBe("2026-11-21");
  expect(parseLookBackSince("2026-11-22", TODAY)).toBeUndefined();
  expect(parseLookBackSince("2026-02-30", TODAY)).toBeUndefined();
  expect(parseLookBackSince("yesterday", TODAY)).toBeUndefined();
});
