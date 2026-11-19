// The inbox and backlog settings follow a rename or move of their note, or of a
// folder that holds it.
import { afterEach, expect, test } from "vitest";
import {
  awaitAsync,
  evalJs,
  evalJson,
  startAsync,
  waitFor,
} from "./helpers/obsidian";
import { openToday, waitForIdle, waitForNotice } from "./helpers/rollover";
import {
  expectNoErrors,
  plugin,
  readNote,
  reset,
  standardNotes,
} from "./helpers/vault";

const INBOX_CONTENT = "## Captured\n\n- [ ] Buy milk\n- [ ] Call Sam\n";
const BACKLOG_CONTENT = "## Parked\n\n- [ ] Old idea\n";

afterEach(expectNoErrors);

/** The two settings as the plugin holds them in memory. */
const liveSettings = () =>
  evalJson(
    `({ inbox: ${plugin}.settings.inboxNotePath, backlog: ${plugin}.settings.backlogNotePath })`
  );

/** The same two settings as data.json holds them on disk. */
async function storedSettings() {
  await startAsync(`
    const data = await ${plugin}.loadData();
    return { inbox: data.inboxNotePath, backlog: data.backlogNotePath };
  `);
  return awaitAsync();
}

/** Renames a file or folder the way the file explorer does. */
async function rename(from, to) {
  await startAsync(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(from)});
    await app.fileManager.renameFile(file, ${JSON.stringify(to)});
    return true;
  `);
  await awaitAsync();
}

test("the inbox and backlog settings follow a folder rename", async () => {
  await reset({
    notes: {
      ...standardNotes(),
      "Notes/Inbox.md": INBOX_CONTENT,
      "Notes/Backlog.md": BACKLOG_CONTENT,
    },
    settings: {
      inboxNotePath: "Notes/Inbox.md",
      backlogNotePath: "Notes/Backlog.md",
    },
  });

  await rename("Notes", "Capture");
  await waitFor(
    async () => {
      const live = await liveSettings();
      return (
        live.inbox === "Capture/Inbox.md" &&
        live.backlog === "Capture/Backlog.md"
      );
    },
    { message: "the settings to follow the folder rename" }
  );

  await waitFor(
    async () => {
      const stored = await storedSettings();
      return (
        stored.inbox === "Capture/Inbox.md" &&
        stored.backlog === "Capture/Backlog.md"
      );
    },
    { message: "data.json to hold the new paths" }
  );

  // a rollover drains the inbox at its new place
  await openToday();
  await waitForNotice("rolled over");
  await waitForIdle();
  const inbox = await readNote("Capture/Inbox.md");
  expect(inbox).toContain("## Captured");
  expect(inbox).not.toContain("Buy milk");
  expect(inbox).not.toContain("Call Sam");
  expect(await readNote("Notes/Inbox.md")).toBeNull();
});

test("a renamed inbox note is followed", async () => {
  await reset({
    notes: { ...standardNotes(), "Inbox.md": INBOX_CONTENT },
    settings: { inboxNotePath: "Inbox" },
  });

  await rename("Inbox.md", "Captured.md");
  await waitFor(async () => (await liveSettings()).inbox === "Captured.md", {
    message: "the inbox setting to follow the rename",
  });
  await waitFor(async () => (await storedSettings()).inbox === "Captured.md", {
    message: "data.json to hold the new path",
  });
  // no backlog note is set, and none gets set
  expect((await liveSettings()).backlog).toBe("");

  await openToday();
  await waitForNotice("rolled over");
  await waitForIdle();
  const inbox = await readNote("Captured.md");
  expect(inbox).not.toContain("Buy milk");
});

test("an unrelated rename leaves the settings alone", async () => {
  await reset({
    notes: {
      ...standardNotes(),
      "Inbox.md": INBOX_CONTENT,
      "Other.md": "x\n",
    },
    settings: { inboxNotePath: "Inbox.md" },
  });

  await rename("Other.md", "Else.md");
  await waitFor(async () => (await readNote("Else.md")) !== null, {
    message: "the rename to land",
  });
  expect(await liveSettings()).toEqual({ inbox: "Inbox.md", backlog: "" });
  expect(await storedSettings()).toEqual({ inbox: "Inbox.md" });
});
