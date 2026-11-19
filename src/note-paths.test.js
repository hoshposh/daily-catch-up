import { describe, expect, test } from "vitest";
import { followRename } from "./note-paths";

describe("followRename", () => {
  test("the note itself renamed", () => {
    expect(
      followRename("Notes/Inbox.md", "Notes/Inbox.md", "Notes/Capture.md")
    ).toBe("Notes/Capture.md");
  });

  test("the note moved to another folder", () => {
    expect(followRename("Inbox.md", "Inbox.md", "Notes/Inbox.md")).toBe(
      "Notes/Inbox.md"
    );
  });

  test("its folder renamed", () => {
    expect(followRename("Notes/Inbox.md", "Notes", "Capture")).toBe(
      "Capture/Inbox.md"
    );
  });

  test("a parent folder renamed", () => {
    expect(followRename("A/B/Inbox.md", "A", "Z")).toBe("Z/B/Inbox.md");
  });

  test("an unrelated rename", () => {
    expect(followRename("Notes/Inbox.md", "Other.md", "Else.md")).toBeNull();
  });

  test("a folder that only shares a prefix", () => {
    expect(followRename("Notes2/Inbox.md", "Notes", "Capture")).toBeNull();
  });

  test("a note that only shares a prefix", () => {
    expect(followRename("Inbox.md", "Inbox", "Else")).toBeNull();
  });

  test("no note path", () => {
    expect(followRename(null, "a", "b")).toBeNull();
  });

  test("a repeated event for the same rename no longer matches", () => {
    const first = followRename("Notes/Inbox.md", "Notes", "Capture");
    expect(followRename(first, "Notes", "Capture")).toBeNull();
    expect(
      followRename(first, "Notes/Inbox.md", "Capture/Inbox.md")
    ).toBeNull();
  });
});
