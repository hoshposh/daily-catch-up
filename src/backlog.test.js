import { describe, expect, test } from "vitest";
import { appendToBacklog, backlogLines } from "./backlog";

const item = (lines) => ({ lines });

describe("backlogLines", () => {
  test("strips the counter, adds the origin, keeps children", () => {
    expect(
      backlogLines(
        [item(["- [ ] Ship [rolled:: 6] ^id", "  - [ ] Tag"])],
        "2026-11-06"
      )
    ).toEqual(["- [ ] Ship [from:: [[2026-11-06]]] ^id", "  - [ ] Tag"]);
  });

  test("dedents a nested head", () => {
    expect(backlogLines([item(["    - [ ] Tag"])], "d")).toEqual([
      "- [ ] Tag [from:: [[d]]]",
    ]);
  });

  test("dedents children by the head's indentation only", () => {
    expect(
      backlogLines([item(["  - [ ] A", "    - [ ] B", "- c"])], "d")
    ).toEqual(["- [ ] A [from:: [[d]]]", "  - [ ] B", "- c"]);
  });
});

describe("appendToBacklog", () => {
  test("appends to the end without a heading", () => {
    expect(
      appendToBacklog({
        content: "- [ ] old",
        heading: "",
        items: [item(["- [ ] new"])],
        sourceNoteName: "d",
        leadingNewLine: true,
      })
    ).toBe("- [ ] old\n- [ ] new [from:: [[d]]]\n");
  });

  test("creates a missing heading, accepting plain text", () => {
    const out = appendToBacklog({
      content: "",
      heading: "Someday",
      items: [item(["- [ ] x"])],
      sourceNoteName: "d",
      leadingNewLine: true,
    });
    expect(out).toContain("## Someday");
    expect(out.indexOf("## Someday")).toBeLessThan(out.indexOf("- [ ] x"));
  });

  test("a heading that starts with a tag, not `# `, gets the `## ` prefix", () => {
    const out = appendToBacklog({
      content: "",
      heading: "#someday",
      items: [item(["- [ ] x"])],
      sourceNoteName: "d",
      leadingNewLine: true,
    });
    expect(out).toBe("## #someday\n\n- [ ] x [from:: [[d]]]\n");
  });

  test("adds under an existing heading", () => {
    const content = "## Someday\n\n- [ ] a\n\n## Done\n";
    const out = appendToBacklog({
      content,
      heading: "## Someday",
      items: [item(["- [ ] b"])],
      sourceNoteName: "d",
      leadingNewLine: true,
    });
    expect(out.indexOf("- [ ] b")).toBeLessThan(out.indexOf("## Done"));
    expect(out.match(/## Someday/g).length).toBe(1);
  });
});
