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
    ).toBe('Set an After rollover setting to "Mark them" to use this.');
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
      'Set an After rollover setting to "Mark them" to use this.'
    );
    expect(m("mark", false).reason).toBe(
      'Turn on Roll over children of todos (in "Which todos roll over") to use this.'
    );
    expect(m("delete", false).reason).toBe(
      'Needs an After rollover setting set to "Mark them" and Roll over children of todos turned on (in "Which todos roll over").'
    );
  });
  test("an inbox set to Mark uses the marker too", () => {
    const inbox = (action, inboxAction, children = true) =>
      s({
        onRolloverSourceAction: action,
        inboxNotePath: "Inbox.md",
        inboxSourceAction: inboxAction,
        rolloverChildren: children,
      });
    expect(inbox("none", "mark").rolloverSourceMarker).toEqual({
      enabled: true,
      reason: "",
    });
    expect(inbox("none", "mark").moveNestedItemsOnMark).toEqual({
      enabled: true,
      reason: "",
    });
    expect(inbox("mark", "delete").rolloverSourceMarker.enabled).toBe(true);
    expect(inbox("none", "mark", false).moveNestedItemsOnMark.reason).toBe(
      'Turn on Roll over children of todos (in "Which todos roll over") to use this.'
    );
  });
  test("the reason is the same with an inbox set", () => {
    const inbox = (children) =>
      s({
        onRolloverSourceAction: "none",
        inboxNotePath: "Inbox.md",
        inboxSourceAction: "delete",
        rolloverChildren: children,
      });
    expect(inbox(true).rolloverSourceMarker).toEqual({
      enabled: false,
      reason: 'Set an After rollover setting to "Mark them" to use this.',
    });
    expect(inbox(true).moveNestedItemsOnMark.reason).toBe(
      'Set an After rollover setting to "Mark them" to use this.'
    );
    expect(inbox(false).moveNestedItemsOnMark.reason).toBe(
      'Needs an After rollover setting set to "Mark them" and Roll over children of todos turned on (in "Which todos roll over").'
    );
  });
  test("an inbox action does not count while no inbox is set", () => {
    for (const inboxNotePath of [undefined, "", "  "]) {
      const states = s({
        onRolloverSourceAction: "none",
        inboxNotePath,
        inboxSourceAction: "mark",
        rolloverChildren: true,
      });
      // an inbox action set to Mark is not enough without an inbox note
      expect(states.rolloverSourceMarker).toEqual({
        enabled: false,
        reason: 'Set an After rollover setting to "Mark them" to use this.',
      });
      expect(states.moveNestedItemsOnMark).toEqual({
        enabled: false,
        reason: 'Set an After rollover setting to "Mark them" to use this.',
      });
    }
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

test("inbox settings need an Inbox note", () => {
  for (const path of ["", "  "]) {
    const states = s({ inboxNotePath: path });
    for (const key of ["inboxSourceAction", "inboxHeading"]) {
      expect(states[key]).toEqual({
        enabled: false,
        reason: "Set an Inbox note to use this.",
      });
    }
  }
  const on = s({ inboxNotePath: "Inbox.md" });
  expect(on.inboxSourceAction).toEqual({ enabled: true, reason: "" });
  expect(on.inboxHeading).toEqual({ enabled: true, reason: "" });
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

describe("Look back", () => {
  const met = {
    onRolloverSourceAction: "delete",
    skipExistingTodos: true,
    lookBackDays: 3,
  };
  test("both enabled when everything is set", () => {
    expect(s(met).lookBackDays).toEqual({ enabled: true, reason: "" });
    expect(s(met).lookBackSince).toEqual({ enabled: true, reason: "" });
  });
  test("both dependencies missing", () => {
    const reason =
      'Needs After rollover set to "Mark them" or "Delete them" and Skip todos already in today\'s note turned on.';
    expect(s({}).lookBackDays).toEqual({ enabled: false, reason });
    expect(s({}).lookBackSince).toEqual({ enabled: false, reason });
  });
  test("only the action is missing", () => {
    const st = s({ ...met, onRolloverSourceAction: "none" });
    const reason =
      'Set After rollover to "Mark them" or "Delete them" to use this.';
    expect(st.lookBackDays).toEqual({ enabled: false, reason });
    expect(st.lookBackSince).toEqual({ enabled: false, reason });
  });
  test("only Skip existing todos is missing", () => {
    const st = s({ ...met, skipExistingTodos: false });
    const reason = "Turn on Skip todos already in today's note to use this.";
    expect(st.lookBackDays).toEqual({ enabled: false, reason });
    expect(st.lookBackSince).toEqual({ enabled: false, reason });
  });
  test("Read notes from waits for days of 1 or more", () => {
    const st = s({ ...met, lookBackDays: 0 });
    expect(st.lookBackDays.enabled).toBe(true);
    expect(st.lookBackSince).toEqual({
      enabled: false,
      reason: "Set Look back to 1 day or more to use this.",
    });
  });
});
