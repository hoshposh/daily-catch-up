// Rules: each matches a todo by tag, heading or regex and has one effect.
// Pure, so matching can be tested without Obsidian. The parser asks
// isIgnoredByRules() about each open todo line; the decision stage asks
// ruleResult() about each item's head line. A rule with a problem, a disabled
// rule or a malformed object never matches and never throws.

import { LIST_PREFIX, TAG_END, headingText } from "./get-todos.js";
import { normalizeHeading } from "./backlog.js";
import { isCancelAvailable } from "./source-action.js";
import { stripRolledCount } from "./rolled-count.js";

export const MATCH_TYPES = ["tag", "heading", "regex"];
export const EFFECTS = [
  "roll",
  "backlog",
  "cancel",
  "leave",
  "ignore",
  "noStale",
  "move",
];
export const OUTCOME_EFFECTS = ["roll", "backlog", "cancel", "leave"];

// Names shown in the settings tab and the rule dialog
export const MATCH_LABELS = { tag: "Tag", heading: "Heading", regex: "Regex" };
export const EFFECT_LABELS = {
  roll: "Roll",
  backlog: "Backlog",
  cancel: "Cancel",
  leave: "Leave",
  ignore: "Not a todo",
  noStale: "No stale count",
  move: "Move to heading",
};

// The spec's example rules, all switched off. Seeded into settings when the
// stored settings have no `rules` key.
export const EXAMPLE_RULES = [
  ["tag", "#someday", "backlog"],
  ["tag", "#maybe", "backlog"],
  ["tag", "#waiting", "noStale"],
  ["tag", "#habit", "leave"],
  ["heading", "Meetings", "leave"],
  ["heading", "Log", "ignore"],
  ["heading", "Inbox", "roll"],
  ["heading", "Top 3 today", "move", "## Inbox"],
  ["regex", String.raw`^@\w+$`, "ignore"],
].map(([match, value, effect, target], i) => ({
  id: `example-${i + 1}`,
  enabled: false,
  match,
  value,
  effect,
  ...(target === undefined ? {} : { target }),
}));

/**
 * The stored rule list with everything that is not a rule object removed
 * (a hand-edited null, number, string or array), so the settings tab can
 * always edit what is left. Objects with bad fields are kept: they stay
 * inert and their row says why.
 */
export function sanitizeRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.filter(
    (rule) => rule !== null && typeof rule === "object" && !Array.isArray(rule)
  );
}

const isBlank = (value) => typeof value !== "string" || value.trim() === "";

const VALUE_PROMPTS = {
  tag: "Enter a tag.",
  heading: "Enter a heading.",
  regex: "Enter a pattern.",
};

/**
 * Why `rule` cannot be used, or "" when it can.
 *
 * @returns {string}
 */
export function ruleProblem(rule) {
  if (
    rule === null ||
    typeof rule !== "object" ||
    !MATCH_TYPES.includes(rule.match) ||
    !EFFECTS.includes(rule.effect)
  ) {
    return "Unknown rule.";
  }
  if (isBlank(rule.value)) return VALUE_PROMPTS[rule.match];
  if (rule.match === "regex") {
    try {
      new RegExp(rule.value, "u");
    } catch (error) {
      return `This pattern is invalid: ${error.message}`;
    }
  }
  if (rule.effect === "move" && isBlank(rule.target)) {
    return "Enter the heading to move to.";
  }
  return "";
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// The tag a Tag rule looks for: "@word" as is, anything else with one "#"
export function normalizeTag(value) {
  const trimmed = value.trim();
  return trimmed.startsWith("@") ? trimmed : `#${trimmed.replace(/^#/, "")}`;
}

// Text in inline code is not a tag (as in hasRolledMarker)
const withoutInlineCode = (line) =>
  line.replace(/(`+)[\s\S]*?[^`]\1(?!`)/g, " ");

/**
 * The rule's match as shown to the user: `Tag #someday`, `Heading "Inbox"`,
 * `Regex ^idea:`. A blank value shows as "(empty)".
 */
export function ruleLabel(rule) {
  const value = typeof rule?.value === "string" ? rule.value : "";
  const blank = value.trim() === "";
  switch (rule?.match) {
    case "tag":
      return `Tag ${blank ? "(empty)" : normalizeTag(value)}`;
    case "heading":
      return `Heading ${blank ? "(empty)" : `"${value.replace(/^[#\s]+/, "").trim()}"`}`;
    case "regex":
      return `Regex ${blank ? "(empty)" : value}`;
    default:
      return "Unknown rule";
  }
}

/** The rule as one line for its row in settings: `Tag #someday → Backlog`. */
export function ruleSummary(rule) {
  if (rule?.effect === "move") {
    const target = isBlank(rule.target) ? "(empty)" : normalizeHeading(rule.target);
    return `${ruleLabel(rule)} → Move to ${target}`;
  }
  return `${ruleLabel(rule)} → ${EFFECT_LABELS[rule?.effect] ?? "?"}`;
}

/**
 * Why the rule does nothing with these settings, or "" when it works: a
 * problem with the rule itself first, then a setting its effect needs.
 */
export function ruleNote(rule, settings) {
  const problem = ruleProblem(rule);
  if (problem) return problem;
  if (rule.effect === "backlog" && isBlank(settings.backlogNotePath)) {
    return 'Set a Backlog note (in "Review and backlog") to use this rule.';
  }
  if (rule.effect === "cancel" && !isCancelAvailable(settings)) {
    return "Cancel is not offered, because the cancel marker is not one of the done status markers.";
  }
  if (rule.effect === "noStale" && !settings.trackRolloverCount) {
    return 'Turn on Count rollovers (in "Aging") to use this rule.';
  }
  return "";
}

let idCounter = 0;

/** A new rule id, unique within this session and across restarts. */
export function newRuleId() {
  idCounter += 1;
  return `rule-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

function matches(rule, headLine, headingPath) {
  switch (rule.match) {
    case "tag": {
      const tag = escapeRegExp(normalizeTag(rule.value));
      return new RegExp(`(?:^|\\s)${tag}(?=$|/|${TAG_END})`, "iu").test(
        withoutInlineCode(headLine)
      );
    }
    case "heading": {
      const wanted = headingText(rule.value);
      return headingPath.some((h) => headingText(h) === wanted);
    }
    case "regex":
      return new RegExp(rule.value, "u").test(
        stripRolledCount(headLine).replace(LIST_PREFIX, "").trim()
      );
    default:
      return false;
  }
}

/**
 * Whether `rule` is switched on, usable and matches the todo whose own line is
 * `headLine`, under the headings `headingPath` (outermost first).
 */
export function ruleMatches(rule, headLine, headingPath) {
  if (!rule?.enabled || ruleProblem(rule) !== "") return false;
  return matches(rule, headLine, headingPath);
}

const asList = (rules) => (Array.isArray(rules) ? rules : []);

/** Whether a switched-on "Not a todo" rule matches the line. */
export function isIgnoredByRules(line, headingPath, rules) {
  return asList(rules).some(
    (rule) => rule?.effect === "ignore" && ruleMatches(rule, line, headingPath)
  );
}

/**
 * What the rules say about one item. Within each kind (outcome, no stale
 * count, move) the first matching rule wins; kinds combine. An outcome that
 * is not available (Backlog without a backlog note, Cancel when it is not
 * offered) leaves the outcome to the normal default, and the next outcome rule
 * does not take over. "Not a todo" rules are the parser's business.
 *
 * @param {string} headLine - the item's own line
 * @param {string[]} headingPath
 * @param {object[]} rules
 * @param {{ backlogEnabled: boolean, cancelEnabled: boolean }} availability
 */
export function ruleResult(
  headLine,
  headingPath,
  rules,
  { backlogEnabled, cancelEnabled }
) {
  const result = {
    outcome: null,
    outcomeRule: null,
    noStale: false,
    noStaleRule: null,
    moveTo: null,
    moveRule: null,
  };
  let outcomeDecided = false;
  for (const rule of asList(rules)) {
    if (!ruleMatches(rule, headLine, headingPath)) continue;
    if (OUTCOME_EFFECTS.includes(rule.effect)) {
      if (outcomeDecided) continue;
      outcomeDecided = true;
      const available =
        (rule.effect !== "backlog" || backlogEnabled) &&
        (rule.effect !== "cancel" || cancelEnabled);
      if (available) {
        result.outcome = rule.effect;
        result.outcomeRule = rule;
      }
    } else if (rule.effect === "noStale" && !result.noStaleRule) {
      result.noStale = true;
      result.noStaleRule = rule;
    } else if (rule.effect === "move" && !result.moveRule) {
      result.moveTo = normalizeHeading(rule.target);
      result.moveRule = rule;
    }
  }
  return result;
}
