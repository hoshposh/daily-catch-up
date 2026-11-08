import { describe, expect, test } from "vitest";
import {
  DEPENDENT_SETTINGS,
  cancelMarkerNote,
  dependentSettingStates,
} from "./settings-dependencies";

const s = (o) => dependentSettingStates(o);

test("one state per dependent setting", () => {
  expect(Object.keys(s({})).sort()).toEqual([...DEPENDENT_SETTINGS].sort());
});

describe("Review automatic rollovers", () => {
  test("on when automatic rollover is on or was never saved", () => {
    expect(s({ rolloverOnFileCreate: true }).reviewOnAutoRollover).toEqual({
      enabled: true,
      reason: "",
    });
    expect(s({}).reviewOnAutoRollover.enabled).toBe(true);
  });
  test("off when automatic rollover is off", () => {
    expect(s({ rolloverOnFileCreate: false }).reviewOnAutoRollover).toEqual({
      enabled: false,
      reason:
        "Turn on Automatic rollover to use this. The Review and roll over todos command always shows the review.",
    });
  });
});

test("Skip completed children follows Roll over children", () => {
  expect(s({ rolloverChildren: true }).skipCompletedChildren.enabled).toBe(
    true
  );
  expect(s({ rolloverChildren: false }).skipCompletedChildren.reason).toBe(
    "Turn on Roll over children of todos to use this."
  );
});

describe("marking", () => {
  test("Marker character needs the mark action, resolved like the plugin does", () => {
    expect(
      s({ onRolloverSourceAction: "mark" }).rolloverSourceMarker.enabled
    ).toBe(true);
    expect(
      s({ onRolloverSourceAction: "delete" }).rolloverSourceMarker.reason
    ).toBe('Set After rollover to "Mark them" to use this.');
    expect(s({}).rolloverSourceMarker.enabled).toBe(false); // resolves to "none"
    expect(
      s({ onRolloverSourceAction: "bogus" }).rolloverSourceMarker.enabled
    ).toBe(false);
  });
  test("Move nested items names only the unmet conditions", () => {
    const m = (action, children) =>
      s({ onRolloverSourceAction: action, rolloverChildren: children })
        .moveNestedItemsOnMark;
    expect(m("mark", true)).toEqual({ enabled: true, reason: "" });
    expect(m("none", true).reason).toBe(
      'Set After rollover to "Mark them" to use this.'
    );
    expect(m("mark", false).reason).toBe(
      'Turn on Roll over children of todos (in "Which todos roll over") to use this.'
    );
    expect(m("delete", false).reason).toBe(
      'Needs After rollover set to "Mark them" and Roll over children of todos turned on (in "Which todos roll over").'
    );
  });
});

test("Backlog heading needs a non-blank Backlog note", () => {
  expect(s({ backlogNotePath: "Backlog.md" }).backlogHeading.enabled).toBe(
    true
  );
  expect(s({ backlogNotePath: "   " }).backlogHeading.reason).toBe(
    "Set a Backlog note to use this."
  );
  expect(s({}).backlogHeading.enabled).toBe(false);
});

test("stale settings need Count rollovers", () => {
  for (const key of ["staleAfterRollovers", "staleBehavior"]) {
    expect(s({ trackRolloverCount: true })[key].enabled).toBe(true);
    expect(s({ trackRolloverCount: false })[key].reason).toBe(
      "Turn on Count rollovers to use this."
    );
  }
});

test("cancelMarkerNote", () => {
  expect(
    cancelMarkerNote({ doneStatusMarkers: "xX-", cancelMarker: "-" })
  ).toBe("");
  expect(cancelMarkerNote({ doneStatusMarkers: "xX", cancelMarker: "-" })).toBe(
    "Cancel is currently not offered, because this character is not one of the done status markers."
  );
});
