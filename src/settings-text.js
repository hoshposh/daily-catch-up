// Text for the settings tab (src/ui/RolloverSettingTab.js): group titles and
// help, setting labels and their one-line descriptions. Kept out of the UI so
// it can be checked by tests. `**…**` in help text marks bold words; the tab
// renders it with DOM helpers (helpSegments), never as HTML.

export const SETTING_GROUPS = [
  {
    id: "when",
    title: "When it runs",
    help: [
      "The rollover runs when today's daily note is created, if Automatic rollover is on. You can also run it any time with **Rollover Todos Now**, or with **Review and roll over todos**, which always shows the review.",
      "Review automatic rollovers decides whether an automatic run shows the review first: never, only when a todo is stale (needs Count rollovers), or always. Closing the review skips that rollover and writes nothing.",
    ],
  },
  {
    id: "which",
    title: "Which todos roll over",
    help: [
      "An open todo is a checkbox whose character isn't one of the done status markers. With Roll over children, the bullets and todos nested under it come too, and Skip completed children leaves completed ones behind.",
      "Empty todos, todos in callouts or blockquotes, and todos that today's note already has can each be left out. Lines inside fenced code blocks never count as todos.",
    ],
  },
  {
    id: "where",
    title: "Where they go in today's note",
    help: [
      "With a template heading, todos go under it, and the headings they had in the previous day's note are recreated just below it, keeping their levels.",
      'With no template heading ("None"), they go under those same headings in today\'s note, which are created when missing.',
      "If today's note doesn't have the template heading, they go to the end of the note and a notice says so.",
      "Blank line after a heading separates a heading from the todos placed directly under it. Todos added to an existing list continue it.",
    ],
  },
  {
    id: "previous",
    title: "What happens to the previous day's note",
    help: [
      "After today's note has a copy of the todos, the previous day's note can be left alone (the safest), marked, or cleaned up.",
      "**Mark them** changes each rolled todo's checkbox to the marker character, e.g. [>] for forwarded. Completed items and plain text aren't touched. With Move nested items, the nested items move to today's note and only the marked todo stays.",
      "**Delete them** removes the rolled todos, and headings left empty go too. **Undo last rollover** reverses either change for 2 minutes.",
    ],
  },
  {
    id: "review",
    title: "Review and backlog",
    help: [
      "The review dialog lets you choose for each todo: **Roll** it to today, send it to the **Backlog** note, **Cancel** it (its checkbox gets the cancel marker), or **Leave** it untouched in the previous day's note.",
      "The Backlog choice appears only when a Backlog note is set. The note and its folder are created when missing. Cancel appears only when the cancel marker is one of your done status markers, so a cancelled todo isn't rolled over again.",
    ],
  },
  {
    id: "aging",
    title: "Aging",
    help: [
      "With Count rollovers, each rolled todo gets a [rolled:: n] counter. The counter goes before any Tasks plugin dates and before a block id, so they keep working.",
      "A todo is stale once its count reaches Stale after. Stale todos get a badge in the review, can open the review on their own, and can go straight to the backlog when no review is shown.",
    ],
  },
];

export const SETTING_LABELS = {
  rolloverOnFileCreate: "Automatic rollover for new daily notes",
  reviewOnAutoRollover: "Review automatic rollovers",
  doneStatusMarkers: "Done status markers",
  rolloverChildren: "Roll over children of todos",
  skipCompletedChildren: "Skip completed children",
  removeEmptyTodos: "Remove empty todos",
  ignoreBlockquotes: "Ignore todos in callouts and blockquotes",
  skipExistingTodos: "Skip todos already in today's note",
  templateHeading: "Template heading",
  leadingNewLine: "Blank line after a heading",
  onRolloverSourceAction: "After rollover, on the previous day's note",
  rolloverSourceMarker: "Marker character",
  moveNestedItemsOnMark: "Move nested items when marking",
  cancelMarker: "Cancel marker",
  backlogNotePath: "Backlog note",
  backlogHeading: "Backlog heading",
  trackRolloverCount: "Count rollovers",
  staleAfterRollovers: "Stale after",
  staleBehavior: "When a todo is stale",
};

export const SETTING_DESCRIPTIONS = {
  rolloverOnFileCreate: "Roll over todos when today's daily note is created.",
  reviewOnAutoRollover:
    'Show the review dialog before an automatic rollover. "Only when a todo is stale" needs Count rollovers (in "Aging").',
  doneStatusMarkers: 'Checkbox characters that count as done, e.g. "xX-".',
  rolloverChildren: "Bring the items nested under a todo along with it.",
  skipCompletedChildren: "Leave completed nested todos behind.",
  removeEmptyTodos:
    "Don't roll over todos with no text. With \"Delete them\", empty todos are still deleted from the previous day's note.",
  ignoreBlockquotes: "Don't roll over todos in lines that start with '>'.",
  skipExistingTodos:
    "Don't roll over a todo that today's note already has. It is still marked or deleted in the previous day's note.",
  templateHeading: "Heading in today's note to put the todos under.",
  templateHeadingText:
    "Heading in today's note to put the todos under, e.g. '## Tasks', or 'none' for the end of the note. Your template's headings couldn't be read.",
  leadingNewLine:
    "Add a blank line between a heading and the todos placed under it.",
  onRolloverSourceAction:
    "What to do with rolled todos in the previous day's note.",
  rolloverSourceMarker: `Checkbox character "Mark them" uses, e.g. ">".`,
  moveNestedItemsOnMark:
    "Keep only the marked todo; its nested items move to today's note.",
  cancelMarker:
    "Checkbox character a todo gets when you choose Cancel. Cancel is offered only when it is one of your done status markers.",
  backlogNotePath:
    "Note that receives todos you send to the backlog. Empty turns the Backlog choice off.",
  backlogHeading:
    "Heading in the backlog note to add todos under; empty means the end of the note.",
  trackRolloverCount:
    "Add [rolled:: n] to each rolled todo, raised by one per rollover.",
  staleAfterRollovers:
    "Number of rollovers after which a todo is stale; 0 turns this off.",
  staleBehavior:
    'What happens to a stale todo when no review is shown. "Move it to the backlog" needs a Backlog note (in "Review and backlog").',
};

/**
 * Splits a help paragraph on matched `**…**` pairs. An unmatched `**` stays as
 * literal text, so no text is ever lost.
 *
 * @returns {{ text: string, bold: boolean }[]}
 */
export function helpSegments(paragraph) {
  const parts = paragraph.split("**");
  // An even number of parts means an odd number of markers: the last is unmatched
  if (parts.length % 2 === 0) {
    const last = parts.pop();
    parts[parts.length - 1] += "**" + last;
  }
  return parts
    .map((text, i) => ({ text, bold: i % 2 === 1 }))
    .filter((segment) => segment.text !== "");
}
