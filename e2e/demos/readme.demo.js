// The README demo (demo.gif): today's note is created, the review dialog
// flags a stale todo and a #someday todo for the backlog, one todo is
// cancelled, and today's note gets the rest under their headings.
// Record with `pnpm demo readme`, watch e2e/demos/out/readme.gif, and only
// then copy it over demo.gif.
import { afterEach, test } from "vitest";
import { EXAMPLE_RULES } from "../../src/rules";
import { cleanupDemo, record } from "../helpers/demo";
import { evalJs } from "../helpers/obsidian";
import { choose, click, highlight, pause } from "../helpers/pointer";
import { openToday, waitForIdle, waitForReview } from "../helpers/rollover";
import { day, fixture, reset } from "../helpers/vault";

afterEach(cleanupDemo);

const YESTERDAY = `daily/${day(-1)}.md`;
const BACKLOG = "Backlog.md";
const SOMEDAY_RULE = "example-1";

const open = (notePath) =>
  evalJs(
    `app.workspace.openLinkText(${JSON.stringify(
      notePath
    )}, '', false).then(() => true)`
  );

const APPLY =
  "[...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Apply')";

/** The open (unchecked) todo lines in the active note's editor. */
const OPEN_TODOS =
  '.workspace-leaf.mod-active .cm-line.HyperMD-task-line[data-task=" "]';
const HIGHLIGHT_MS = 2200;

/** Highlights the active note's open todos; fails if the selector found none. */
async function highlightOpenTodos(expected) {
  const covered = await highlight(OPEN_TODOS, HIGHLIGHT_MS);
  if (covered !== expected) {
    throw new Error(`Highlighted ${covered} open todos, expected ${expected}`);
  }
  await pause(HIGHLIGHT_MS + 200);
}

test("readme", async () => {
  await reset({
    notes: {
      "templates/daily.md": fixture("demo-template.md"),
      [YESTERDAY]: fixture("demo-previous.md"),
    },
    settings: {
      templateHeading: "none",
      rolloverChildren: true,
      trackRolloverCount: true,
      reviewOnAutoRollover: "stale",
      staleBehavior: "backlog",
      backlogNotePath: BACKLOG,
      rules: EXAMPLE_RULES.map((rule) => ({
        ...rule,
        enabled: rule.id === SOMEDAY_RULE,
      })),
    },
  });
  await open(YESTERDAY);

  await record(
    "readme",
    {
      width: 880,
      height: 720,
      collapsePanels: true,
      maxBytes: 2_097_152,
    },
    async () => {
      await pause(1000);
      // what the rollover will act on: every open todo, nested ones too
      await highlightOpenTodos(6);
      await openToday();
      await waitForReview();
      await pause(2500);
      await choose("Review Sam's pull request", "cancel");
      await pause(1500);
      await click(APPLY);
      await waitForIdle();
      await pause(600);
      // what arrived (today's template has no todos of its own)
      await highlightOpenTodos(3);
      await pause(800);
      await open(BACKLOG);
      await pause(2000);
    }
  );
});
