import { expect, test } from "vitest";
import {
  SETTING_DESCRIPTIONS,
  SETTING_GROUPS,
  SETTING_LABELS,
  helpSegments,
} from "./settings-text";

test("eight groups in spec order, each with help", () => {
  expect(SETTING_GROUPS.map((g) => g.title)).toEqual([
    "When it runs",
    "Which todos roll over",
    "Where they go in today's note",
    "What happens to the previous day's note",
    "Inbox",
    "Review and backlog",
    "Aging",
    "Rules",
  ]);
  for (const g of SETTING_GROUPS) expect(g.help.length).toBeGreaterThan(0);
});

test("the inbox group follows the previous-note group and names QuickAdd", () => {
  const ids = SETTING_GROUPS.map((g) => g.id);
  expect(ids.indexOf("inbox")).toBe(ids.indexOf("previous") + 1);
  const { help } = SETTING_GROUPS.find((g) => g.id === "inbox");
  expect(
    help.some((p) => p.includes("QuickAdd") && /only checkbox/i.test(p))
  ).toBe(true);
});

test("inbox labels", () => {
  expect(SETTING_LABELS.inboxNotePath).toBe("Inbox note");
  expect(SETTING_LABELS.inboxSourceAction).toBe("After rollover, in the inbox");
  expect(SETTING_LABELS.inboxHeading).toBe("Heading for inbox todos");
});

test("renamed labels", () => {
  expect(SETTING_LABELS.removeEmptyTodos).toBe("Remove empty todos");
  expect(SETTING_LABELS.leadingNewLine).toBe("Blank line after a heading");
});

test("every labelled setting has a short, single-line description", () => {
  for (const key of Object.keys(SETTING_LABELS)) {
    const d = SETTING_DESCRIPTIONS[key];
    expect(d, key).toBeTruthy();
    expect(d.includes("\n"), key).toBe(false);
    expect(d.length, key).toBeLessThanOrEqual(160);
  }
});

test("helpSegments", () => {
  expect(helpSegments("a **b** c")).toEqual([
    { text: "a ", bold: false },
    { text: "b", bold: true },
    { text: " c", bold: false },
  ]);
  expect(helpSegments("plain")).toEqual([{ text: "plain", bold: false }]);
  expect(
    helpSegments("odd ** marker")
      .map((x) => x.text)
      .join("")
  ).toBe("odd ** marker");
});
