import { describe, expect, test } from "vitest";
import {
  EXAMPLE_RULES,
  isIgnoredByRules,
  ruleMatches,
  ruleProblem,
  newRuleId,
  ruleLabel,
  ruleNote,
  ruleResult,
  ruleSummary,
  sanitizeRules,
} from "./rules";

const rule = (match, value, effect, extra = {}) => ({
  id: value,
  enabled: true,
  match,
  value,
  effect,
  ...extra,
});
const avail = { backlogEnabled: true, cancelEnabled: true };

describe("rule matching", () => {
  test("tag matches whole tags, nested tags and @contexts, ignoring case and code", () => {
    const r = rule("tag", "someday", "backlog");
    expect(ruleMatches(r, "- [ ] Learn Rust #someday", [])).toBe(true);
    expect(ruleMatches(r, "- [ ] Learn Rust #Someday/later", [])).toBe(true);
    expect(ruleMatches(r, "- [ ] Learn Rust #somedayish", [])).toBe(false);
    expect(ruleMatches(r, "- [ ] Learn `#someday` syntax", [])).toBe(false);
    expect(ruleMatches(r, "- [ ] foo#someday", [])).toBe(false);
    expect(
      ruleMatches(rule("tag", "#someday", "backlog"), "- [ ] x #someday", [])
    ).toBe(true);
    expect(
      ruleMatches(
        rule("tag", "@errands", "move", { target: "Errands" }),
        "- [ ] Stamps @errands",
        []
      )
    ).toBe(true);
  });

  test("heading matches any heading in the path by text", () => {
    const r = rule("heading", "## meetings", "leave");
    expect(ruleMatches(r, "- [ ] a", ["## Work", "### Meetings"])).toBe(true);
    expect(ruleMatches(r, "- [ ] a", ["## Meetings notes"])).toBe(false);
    expect(ruleMatches(r, "- [ ] a", [])).toBe(false);
  });

  test("regex is case-sensitive and sees the text after the checkbox", () => {
    const r = rule("regex", "^@\\w+$", "ignore");
    expect(ruleMatches(r, "- [ ] @Alice", [])).toBe(true);
    expect(ruleMatches(r, "> - [ ] @Alice", [])).toBe(true);
    expect(ruleMatches(r, "- [ ] ask @Alice", [])).toBe(false);
    expect(
      ruleMatches(rule("regex", "^idea:", "backlog"), "- [ ] Idea: x", [])
    ).toBe(false);
  });

  test("disabled, invalid and malformed rules never match and never throw", () => {
    expect(
      ruleMatches(
        { ...rule("tag", "a", "leave"), enabled: false },
        "- [ ] #a",
        []
      )
    ).toBe(false);
    expect(ruleProblem(rule("regex", "(", "leave"))).toMatch(
      /^This pattern is invalid: /
    );
    expect(ruleMatches(rule("regex", "(", "leave"), "- [ ] (", [])).toBe(false);
    for (const bad of [
      null,
      {},
      { enabled: true, match: "tag", value: 42, effect: "leave" },
      rule("tag", "a", "explode"),
    ]) {
      expect(() => ruleResult("- [ ] #a", [], [bad], avail)).not.toThrow();
      expect(() => isIgnoredByRules("- [ ] #a", [], [bad])).not.toThrow();
    }
    expect(ruleProblem(null)).toBe("Unknown rule.");
    expect(ruleProblem(rule("tag", "a", "explode"))).toBe("Unknown rule.");
    expect(ruleProblem(rule("tag", "  ", "leave"))).toBe("Enter a tag.");
    expect(ruleProblem(rule("heading", "", "leave"))).toBe("Enter a heading.");
    expect(ruleProblem(rule("regex", "", "leave"))).toBe("Enter a pattern.");
    expect(ruleProblem(rule("heading", "Top", "move", { target: " " }))).toBe(
      "Enter the heading to move to."
    );
    expect(
      ruleProblem(rule("heading", "Top", "move", { target: "Inbox" }))
    ).toBe("");
  });

  test("first match wins within a kind; kinds combine", () => {
    const rules = [
      rule("heading", "Top 3 today", "move", { target: "Inbox" }),
      rule("tag", "waiting", "noStale"),
      rule("tag", "waiting", "leave"),
      rule("heading", "Top 3 today", "roll"),
    ];
    const r = ruleResult(
      "- [ ] Call Bob #waiting",
      ["## Top 3 today"],
      rules,
      avail
    );
    expect(r.outcome).toBe("leave");
    expect(r.outcomeRule).toBe(rules[2]);
    expect(r.noStale).toBe(true);
    expect(r.noStaleRule).toBe(rules[1]);
    expect(r.moveTo).toBe("## Inbox");
    expect(r.moveRule).toBe(rules[0]);
  });

  test("an unavailable outcome falls back without letting the next rule take over", () => {
    const rules = [
      rule("tag", "someday", "backlog"),
      rule("tag", "someday", "leave"),
    ];
    const r = ruleResult("- [ ] x #someday", [], rules, {
      backlogEnabled: false,
      cancelEnabled: true,
    });
    expect(r.outcome).toBe(null);
    expect(r.outcomeRule).toBe(null);
    expect(
      ruleResult("- [ ] x #c", [], [rule("tag", "c", "cancel")], {
        backlogEnabled: true,
        cancelEnabled: false,
      }).outcome
    ).toBe(null);
  });

  test("ignore rules are only reported by isIgnoredByRules", () => {
    const rules = [rule("regex", "^@\\w+$", "ignore")];
    expect(isIgnoredByRules("- [ ] @Alice", [], rules)).toBe(true);
    expect(isIgnoredByRules("- [ ] Bob", [], rules)).toBe(false);
    expect(ruleResult("- [ ] @Alice", [], rules, avail).outcome).toBe(null);
  });

  test("example rules are the spec's nine, all switched off, and do nothing", () => {
    expect(EXAMPLE_RULES).toHaveLength(9);
    expect(
      EXAMPLE_RULES.every((r) => r.enabled === false && ruleProblem(r) === "")
    ).toBe(true);
    expect(
      ruleResult("- [ ] x #someday", ["## Meetings"], EXAMPLE_RULES, avail)
    ).toEqual({
      outcome: null,
      outcomeRule: null,
      noStale: false,
      noStaleRule: null,
      moveTo: null,
      moveRule: null,
    });
    expect(isIgnoredByRules("- [ ] @Alice", ["## Log"], EXAMPLE_RULES)).toBe(
      false
    );
  });
});

test("ruleLabel names the rule", () => {
  expect(ruleLabel({ match: "tag", value: "someday" })).toBe("Tag #someday");
  expect(ruleLabel({ match: "tag", value: "@errands" })).toBe("Tag @errands");
  expect(ruleLabel({ match: "heading", value: "## Top 3 today" })).toBe(
    'Heading "Top 3 today"'
  );
  expect(ruleLabel({ match: "regex", value: "^@\\w+$" })).toBe("Regex ^@\\w+$");
});

test("summaries", () => {
  expect(ruleSummary(EXAMPLE_RULES[0])).toBe("Tag #someday → Backlog");
  expect(ruleSummary(EXAMPLE_RULES[7])).toBe(
    'Heading "Top 3 today" → Move to ## Inbox'
  );
  expect(ruleSummary(EXAMPLE_RULES[8])).toBe("Regex ^@\\w+$ → Not a todo");
  expect(ruleSummary(EXAMPLE_RULES[2])).toBe("Tag #waiting → No stale count");
  expect(ruleSummary({ match: "tag", value: "", effect: "leave" })).toBe(
    "Tag (empty) → Leave"
  );
});

test("notes", () => {
  const settings = {
    backlogNotePath: "Backlog.md",
    cancelMarker: "-",
    doneStatusMarkers: "xX-",
    trackRolloverCount: true,
  };
  const r = (effect, extra = {}) => ({
    id: "r",
    enabled: true,
    match: "tag",
    value: "a",
    effect,
    ...extra,
  });
  for (const effect of ["roll", "backlog", "cancel", "leave", "ignore", "noStale"]) {
    expect(ruleNote(r(effect), settings)).toBe("");
  }
  expect(ruleNote(r("leave", { value: "" }), settings)).toBe("Enter a tag.");
  expect(ruleNote(r("backlog"), { ...settings, backlogNotePath: "  " })).toBe(
    'Set a Backlog note (in "Review and backlog") to use this rule.'
  );
  expect(ruleNote(r("cancel"), { ...settings, cancelMarker: "~" })).toBe(
    "Cancel is not offered, because the cancel marker is not one of the done status markers."
  );
  expect(ruleNote(r("noStale"), { ...settings, trackRolloverCount: false })).toBe(
    'Turn on Count rollovers (in "Aging") to use this rule.'
  );
});

test("newRuleId is unique", () => {
  const ids = new Set(Array.from({ length: 100 }, () => newRuleId()));
  expect(ids.size).toBe(100);
});

test("regex rules do not see the rollover counter", () => {
  const r = rule("regex", "^@\\w+$", "ignore");
  expect(ruleMatches(r, "- [ ] @Alice [rolled:: 4]", [])).toBe(true);
  expect(isIgnoredByRules("- [ ] @Alice [rolled:: 4]", [], [r])).toBe(true);
});

test("sanitizeRules keeps rule objects and drops what is not one", () => {
  const odd = { enabled: true, match: "tag", value: 42, effect: "leave" };
  expect(sanitizeRules([null, 42, "x", odd, [1]])).toEqual([odd]);
  expect(sanitizeRules(undefined)).toEqual([]);
  expect(sanitizeRules({ 0: odd })).toEqual([]);
});
