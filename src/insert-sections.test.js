import { describe, expect, test } from "vitest";
import { insertSections } from "./insert-sections";

const section = (headingPath, incompleteTodos) => ({ headingPath, incompleteTodos });

describe("insertSections without a template heading", () => {
  test("recreates the headings of yesterday's note, nested as they were", () => {
    const sections = [
      section(
        ["# Work"],
        [
          "- [ ] Ship release",
          "  - [x] Write changelog",
          "  - [ ] Tag version",
          "  - remember to bump manifest",
          "- [ ]",
        ]
      ),
      section(["# Work", "## Home"], ["- [ ] Laundry"]),
    ];
    const result = insertSections({ content: "", sections });
    expect(result).toStrictEqual({
      content: [
        "# Work",
        "",
        "- [ ] Ship release",
        "  - [x] Write changelog",
        "  - [ ] Tag version",
        "  - remember to bump manifest",
        "- [ ]",
        "",
        "## Home",
        "",
        "- [ ] Laundry",
        "",
      ].join("\n"),
      templateHeadingNotFound: false,
    });
  });

  test("creates the whole ancestry when only the child section has todos", () => {
    const result = insertSections({
      content: "",
      sections: [section(["# Work", "## Home"], ["- [ ] a"])],
    });
    expect(result.content).toBe("# Work\n## Home\n\n- [ ] a\n");
  });

  test("puts todos under a heading that today's note already has, whatever its case", () => {
    const result = insertSections({
      content: "## work\n\n## Other\n",
      sections: [section(["## Work"], ["- [ ] a"])],
    });
    expect(result.content).toBe("## work\n\n- [ ] a\n\n## Other\n");
  });

  test("uses the deepest heading that exists and only creates the missing ones", () => {
    const result = insertSections({
      content: "# Plan\n\n## Home\n\n## End\n",
      sections: [section(["# Work", "## Home"], ["- [ ] a"])],
    });
    expect(result.content).toBe("# Plan\n\n## Home\n\n- [ ] a\n\n## End\n");
  });

  test("puts todos for a parent heading above its existing sub-headings", () => {
    const result = insertSections({
      content: "# Work\n\n## Home\n\n- [ ] Laundry\n",
      sections: [section(["# Work"], ["- [ ] Ship release"])],
    });
    expect(result.content).toBe(
      "# Work\n\n- [ ] Ship release\n\n## Home\n\n- [ ] Laundry\n"
    );
  });

  test("appends todos that sit before any heading without creating a heading", () => {
    const result = insertSections({
      content: "# Daily\n",
      sections: [section([], ["- [ ] a"])],
    });
    expect(result.content).toBe("# Daily\n\n- [ ] a\n");
  });

  test("adds no leading blank line to an empty note", () => {
    const result = insertSections({ content: "", sections: [section([], ["- [ ] a"])] });
    expect(result.content).toBe("- [ ] a\n");
  });

  test("without leadingNewLine no blank line follows a created heading", () => {
    const result = insertSections({
      content: "",
      sections: [section(["## Work"], ["- [ ] a"])],
      leadingNewLine: false,
    });
    expect(result.content).toBe("## Work\n- [ ] a\n");
  });

  test("returns the note unchanged when there is nothing to insert", () => {
    expect(insertSections({ content: "abc", sections: [] })).toStrictEqual({
      content: "abc",
      templateHeadingNotFound: false,
    });
  });
});

describe("insertSections with a template heading", () => {
  const base = { templateHeading: "## Tasks" };

  test("puts todos directly under the template heading", () => {
    const result = insertSections({
      ...base,
      content: "## Tasks\n\n## Notes\n",
      sections: [section(["## Tasks"], ["- [ ] a"])],
    });
    expect(result).toStrictEqual({
      content: "## Tasks\n\n- [ ] a\n\n## Notes\n",
      templateHeadingNotFound: false,
    });
  });

  test("puts todos directly under the template heading above its sub-headings", () => {
    const result = insertSections({
      ...base,
      content: "## Tasks\n\n### Sub\n",
      sections: [section(["## Tasks"], ["- [ ] a"])],
    });
    expect(result.content).toBe("## Tasks\n\n- [ ] a\n\n### Sub\n");
  });

  test("creates sub-headings below the template heading", () => {
    const result = insertSections({
      ...base,
      content: "## Tasks\n\n## Notes\n",
      sections: [section(["## Tasks", "### Sub"], ["- [ ] a"])],
    });
    expect(result.content).toBe("## Tasks\n\n### Sub\n\n- [ ] a\n\n## Notes\n");
  });

  test("reports a template heading that is missing and appends at the end", () => {
    const result = insertSections({
      ...base,
      content: "hello\n",
      sections: [section([], ["- [ ] a"])],
    });
    expect(result).toStrictEqual({
      content: "hello\n\n- [ ] a\n",
      templateHeadingNotFound: true,
    });
  });

  test("todos from yesterday's headings go under the template heading, with their ancestors relative to it", () => {
    const result = insertSections({
      ...base,
      content: "## Tasks\n",
      sections: [section(["# Work", "## Home"], ["- [ ] a"])],
    });
    expect(result.content).toBe("## Tasks\n\n# Work\n## Home\n\n- [ ] a\n");
  });
});
