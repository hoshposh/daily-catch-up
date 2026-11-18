// Rules in a real rollover: the defaults and badges they put in the review
// dialog, where moved todos land, and the "Not a todo" and "No stale count"
// effects that index.js passes to the parser and the counter.
import { afterEach, expect, test } from "vitest";
import { evalJson } from "./helpers/obsidian";
import {
  clickButton,
  openToday,
  pressEscape,
  reviewRows,
  runCommand,
  setOutcome,
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

test("the move badge shows only while the todo rolls", async () => {
  const rules = await examplesWith("example-8");
  await reset({
    notes: notesWith("rules-previous.md"),
    settings: {
      templateHeading: "## Tasks",
      reviewOnAutoRollover: "always",
      rules,
    },
  });
  await openToday();
  await waitForReview();
  const badges = async (label) =>
    (await reviewRows()).find((r) => r.label === label)?.badges;
  const MOVE = "→ ## Inbox";

  expect(await badges("Ship release")).toContain(MOVE);
  await setOutcome("Ship release", "leave");
  expect(await badges("Ship release")).not.toContain(MOVE);
  expect(await badges("Call bank")).toContain(MOVE);
  await setOutcome("Ship release", "roll");
  expect(await badges("Ship release")).toContain(MOVE);

  // the shortcuts for every todo (the dialog's first All leave / All roll)
  await clickButton("All leave");
  expect(await badges("Ship release")).not.toContain(MOVE);
  expect(await badges("Call bank")).not.toContain(MOVE);
  await clickButton("All roll");
  expect(await badges("Ship release")).toContain(MOVE);
  expect(await badges("Call bank")).toContain(MOVE);

  await pressEscape();
  await waitForIdle();
});

/** Rolls rules-previous.md into an existing today's note with Top 3 → Inbox on. */
async function moveInto(todayNote) {
  const rules = await examplesWith("example-8");
  await reset({
    notes: {
      ...notesWith("rules-previous.md"),
      [`daily/${day()}.md`]: todayNote,
    },
    settings: { templateHeading: "## Tasks", rules },
  });
  await runCommand("review-and-rollover");
  await waitForReview();
  await clickButton("Apply");
  await waitForIdle();
  return (await readNote(`daily/${day()}.md`)).split("\n");
}

test("moved todos use an existing target outside the template heading", async () => {
  const today = await moveInto(
    "# Work\n\n## Inbox\n\n- [ ] Existing\n\n## Tasks\n\n- [ ] Standup\n"
  );
  // one Inbox, the one above the template heading
  expect(today.filter((line) => line === "## Inbox")).toHaveLength(1);
  expect(section(today, "## Inbox")).toEqual(
    expect.arrayContaining([
      "- [ ] Existing",
      "- [ ] Ship release",
      "- [ ] Call bank",
    ])
  );
  expect(today.indexOf("- [ ] Call bank")).toBeLessThan(
    today.indexOf("## Tasks")
  );
  // todos without a move still go under the template heading
  expect(section(today, "## Tasks")).toContain("- [ ] Write report");
});

test("a missing target goes at the end of the note, not under the template heading", async () => {
  const today = await moveInto(
    "# Work\n\n## Tasks\n\n- [ ] Standup\n\n## Notes\n\nSome notes\n"
  );
  expect(today.filter((line) => line === "## Inbox")).toHaveLength(1);
  expect(today.indexOf("## Inbox")).toBeGreaterThan(
    today.indexOf("Some notes")
  );
  expect(section(today, "## Inbox")).toEqual(
    expect.arrayContaining(["- [ ] Ship release", "- [ ] Call bank"])
  );
  expect(section(today, "## Tasks")).toContain("- [ ] Write report");
  expect(section(today, "## Tasks")).not.toContain("- [ ] Ship release");
});

test("todos from under a plain bullet land at column 0, moved or not", async () => {
  await reset({
    notes: {
      "templates/daily.md": fixture("daily-template.md"),
      [`daily/${day(-1)}.md`]: [
        "## Errands",
        "",
        "- [ ] Stamps @errands",
        "",
        "## Home",
        "",
        "- [ ] Laundry",
        "- Garden",
        "    - [ ] Buy soil @errands",
        "- Kitchen",
        "    - [ ] Descale kettle",
        "        - vinegar works",
        "",
      ].join("\n"),
    },
    settings: {
      rolloverChildren: true,
      rules: [
        {
          id: "errands",
          enabled: true,
          match: "tag",
          value: "@errands",
          effect: "move",
          target: "Shopping",
        },
      ],
    },
  });

  await openToday();
  await waitForNotice("rolled over");
  await waitForIdle();

  const today = (await readNote(`daily/${day()}.md`)).split("\n");
  expect(section(today, "## Shopping").filter((l) => l !== "")).toEqual([
    "- [ ] Stamps @errands",
    "- [ ] Buy soil @errands",
  ]);
  expect(section(today, "## Home").filter((l) => l !== "")).toEqual([
    "- [ ] Laundry",
    "- [ ] Descale kettle",
    "    - vinegar works",
  ]);
});
