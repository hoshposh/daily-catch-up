// When a dependent setting in the settings tab applies, and what to say when it
// does not. Pure, so the rules can be tested without Obsidian; the settings
// tab only renders what these return. A disabled setting keeps its value.

import { isCancelAvailable, resolveSourceAction } from "./source-action";

export const DEPENDENT_SETTINGS = [
  "reviewOnAutoRollover",
  "skipCompletedChildren",
  "rolloverSourceMarker",
  "moveNestedItemsOnMark",
  "backlogHeading",
  "staleAfterRollovers",
  "staleBehavior",
];

const NEEDS_MARK = 'Set After rollover to "Mark them" to use this.';
const NEEDS_COUNT = "Turn on Count rollovers to use this.";

const state = (enabled, reason) => ({ enabled, reason: enabled ? "" : reason });

function moveNestedReason(marking, children) {
  if (!marking && !children) {
    return 'Needs After rollover set to "Mark them" and Roll over children of todos turned on (in "Which todos roll over").';
  }
  if (!marking) return NEEDS_MARK;
  return 'Turn on Roll over children of todos (in "Which todos roll over") to use this.';
}

/**
 * @returns {Record<string, { enabled: boolean, reason: string }>} one entry
 *   per DEPENDENT_SETTINGS key; `reason` is "" when the setting is enabled
 */
export function dependentSettingStates(settings) {
  // Settings saved before this option existed have no key: it counts as on
  const autoRollover = settings.rolloverOnFileCreate !== false;
  const children = Boolean(settings.rolloverChildren);
  const marking = resolveSourceAction(settings) === "mark";
  const counting = Boolean(settings.trackRolloverCount);
  const backlogSet = (settings.backlogNotePath ?? "").trim() !== "";

  return {
    reviewOnAutoRollover: state(
      autoRollover,
      "Turn on Automatic rollover to use this. The Review and roll over todos command always shows the review."
    ),
    skipCompletedChildren: state(
      children,
      "Turn on Roll over children of todos to use this."
    ),
    rolloverSourceMarker: state(marking, NEEDS_MARK),
    moveNestedItemsOnMark: state(
      marking && children,
      moveNestedReason(marking, children)
    ),
    backlogHeading: state(backlogSet, "Set a Backlog note to use this."),
    staleAfterRollovers: state(counting, NEEDS_COUNT),
    staleBehavior: state(counting, NEEDS_COUNT),
  };
}

// The extra sentence under Cancel marker while Cancel is not offered
export function cancelMarkerNote(settings) {
  return isCancelAvailable(settings)
    ? ""
    : "Cancel is currently not offered, because this character is not one of the done status markers.";
}
