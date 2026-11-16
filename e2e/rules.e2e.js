// Rules in a real rollover: the defaults and badges they put in the review
// dialog, where moved todos land, and the "Not a todo" and "No stale count"
// effects that index.js passes to the parser and the counter.
import { afterEach, expect, test } from "vitest";
import { evalJson } from "./helpers/obsidian";
import {
  clickButton,
  openToday,
  reviewRows,
  waitForIdle,
  waitForNotice,
  waitForReview,
} from "./helpers/rollover";
import {
  day,
  expectNoErrors,
  fixture,
  plugin,
  readNote,
  reset,
  standardNotes,
} from "./helpers/vault";

afterEach(expectNoErrors);

const BACKLOG = "Backlog/Backlog.md";

/** The plugin's example rules, with the given ids switched on. */
async function examplesWith(...ids) {
  await reset({ notes: standardNotes() });
  const rules = await evalJson(`${plugin}.settings.rules`);
  return rules.map((rule) => ({ ...rule, enabled: ids.includes(rule.id) }));
}

const notesWith = (previous) => ({
  "templates/daily.md": fixture("daily-template.md"),
  [`daily/${day(-1)}.md`]: fixture(previous),
});

/** The lines under `heading`, up to the next heading. */
function section(lines, heading) {
  const start = lines.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,6}\s/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

test("rules choose defaults and move todos", async () => {
  const rules = await examplesWith("example-1", "example-8");
  await reset({
    notes: notesWith("rules-previous.md"),
    settings: {
      templateHeading: "## Tasks",
      backlogNotePath: BACKLOG,
      reviewOnAutoRollover: "always",
      rules,
    },
  });

  await openToday();
  const rows = await waitForReview();
  const row = (label) => rows.find((r) => r.label === label);
  expect(row("Learn Rust #someday")?.outcome).toBe("backlog");
  expect(row("Learn Rust #someday")?.badges).toContain("Tag #someday");
  expect(row("Ship release")?.badges).toContain("→ ## Inbox");
  expect(row("Call bank")?.badges).toContain("→ ## Inbox");

  await clickButton("Apply");
  await waitForIdle();

  const today = (await readNote(`daily/${day()}.md`)).split("\n");
  const inbox = section(today, "## Inbox");
  const count = (line) => today.filter((l) => l === line).length;
  // moved todos are under ## Inbox and nowhere else (not also under the
  // template heading, ## Tasks, where unmoved todos go)
  for (const moved of ["- [ ] Ship release", "- [ ] Call bank"]) {
    expect(inbox, moved).toContain(moved);
    expect(count(moved), moved).toBe(1);
  }
  expect(count("- [ ] Write report")).toBe(1);
  expect(inbox).not.toContain("- [ ] Write report");
  // the backlog todo went to the backlog note only
  expect(today.filter((l) => l.includes("Learn Rust"))).toEqual([]);
  expect((await readNote(BACKLOG)).split("\n")).toContain(
    `- [ ] Learn Rust #someday [from:: [[${day(-1)}]]]`
  );
});

test("examples come back when the rules key is gone", async () => {
  await reset({
    notes: standardNotes(),
    rawData: { templateHeading: "## Tasks" },
  });
  expect(
    await evalJson(`${plugin}.settings.rules.map((r) => [r.id, r.enabled])`)
  ).toEqual(Array.from({ length: 9 }, (_, i) => [`example-${i + 1}`, false]));
});

test("not-a-todo and no-stale-count rules reach the rollover", async () => {
  const rules = await examplesWith("example-3", "example-6");
  await reset({
    notes: notesWith("rules-aging-previous.md"),
    settings: {
      templateHeading: "## Tasks",
      onRolloverSourceAction: "delete",
      trackRolloverCount: true,
      staleAfterRollovers: 5,
      reviewOnAutoRollover: "stale",
      rules,
    },
  });

  // the only todo over the threshold is exempt, so no review opens: the
  // rollover finishes on its own (with a review, this notice never comes)
  await openToday();
  await waitForNotice("rolled over");
  await waitForIdle();
  expect(await reviewRows()).toBeNull();

  const today = (await readNote(`daily/${day()}.md`)).split("\n");
  expect(today).toContain("- [ ] Write report [rolled:: 2]");
  expect(today).toContain("- [ ] Chase invoice #waiting [rolled:: 6]");
  expect(today.filter((line) => line.includes("Called the bank"))).toEqual([]);

  const previous = (await readNote(`daily/${day(-1)}.md`)).split("\n");
  expect(
    previous.filter((l) => l.includes("Write report") || l.includes("Chase"))
  ).toEqual([]);
  expect(section(previous, "## Log")).toContain("- [ ] Called the bank");
});
