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
      content: "# Work\n\n## Notes\n",
      sections: [section(["# Work", "## Home"], ["- [ ] a"])],
    });
    expect(result.content).toBe("# Work\n\n## Notes\n\n## Home\n\n- [ ] a\n");
  });

  test("does not use a heading of the same name that sits under another parent", () => {
    const result = insertSections({
      content: "# Plan\n\n## Home\n\n## End\n",
      sections: [section(["# Work", "## Home"], ["- [ ] a"])],
    });
    // "# Work" is missing, so the whole path is created instead of reusing "## Home"
    expect(result.content).toBe(
      "# Plan\n\n## Home\n\n## End\n\n# Work\n## Home\n\n- [ ] a\n"
    );
  });

  test("a heading with the same name under two parents is found under the right one", () => {
    const result = insertSections({
      content: "# A\n\n### Notes\n\n# B\n\n### Notes\n",
      sections: [section(["# B", "### Notes"], ["- [ ] x"])],
    });
    expect(result.content).toBe("# A\n\n### Notes\n\n# B\n\n### Notes\n\n- [ ] x\n");
  });

  test("ignores case and surrounding spaces when matching a heading", () => {
    const result = insertSections({
      content: "## work  \n\n## Other\n",
      sections: [section(["## Work"], ["- [ ] a"])],
    });
    expect(result.content).toBe("## work  \n\n- [ ] a\n\n## Other\n");
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

  test("looks for a sub-heading inside the template heading's section only", () => {
    const result = insertSections({
      ...base,
      content: "## Tasks\n\n## Notes\n\n### Sub\n",
      sections: [section(["## Tasks", "### Sub"], ["- [ ] a"])],
    });
    // the "### Sub" under "## Notes" is not used
    expect(result.content).toBe(
      "## Tasks\n\n### Sub\n\n- [ ] a\n\n## Notes\n\n### Sub\n"
    );
  });

  test("a sub-heading missing from its parent is created there, not taken from elsewhere", () => {
    const result = insertSections({
      ...base,
      content: "## Tasks\n\n### Project\n\n### Home\n\n## Notes\n\n#### Deep\n",
      sections: [section(["## Tasks", "### Project", "#### Deep"], ["- [ ] a"])],
    });
    expect(result.content).toBe(
      "## Tasks\n\n### Project\n\n#### Deep\n\n- [ ] a\n\n### Home\n\n## Notes\n\n#### Deep\n"
    );
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

describe("insertSections in a note with CRLF line endings", () => {
  test("inserted lines use CRLF too", () => {
    const result = insertSections({
      templateHeading: "## Tasks",
      content: "## Tasks\r\n\r\n## Notes\r\n",
      sections: [section(["## Tasks"], ["- [ ] a", "  - [ ] b"])],
    });
    expect(result).toStrictEqual({
      content: "## Tasks\r\n\r\n- [ ] a\r\n  - [ ] b\r\n\r\n## Notes\r\n",
      templateHeadingNotFound: false,
    });
  });

  test("appending to an existing list and creating headings keep CRLF", () => {
    const result = insertSections({
      content: "# Daily\r\n\r\n- [ ] first\r\n",
      sections: [section(["# Daily"], ["- [ ] a"]), section(["# Daily", "## Work"], ["- [ ] b"])],
    });
    expect(result.content).toBe(
      "# Daily\r\n\r\n- [ ] first\r\n- [ ] a\r\n\r\n## Work\r\n\r\n- [ ] b\r\n"
    );
  });

  test("the line ending that most lines have decides", () => {
    const result = insertSections({
      templateHeading: "## T",
      content: "## T\r\n- [ ] a\r\n\r\n## N\n",
      sections: [section(["## T"], ["- [ ] x"])],
    });
    expect(result.content).toBe("## T\r\n- [ ] a\r\n- [ ] x\r\n\r\n## N\r\n");
  });

  test("a note with LF endings gets none added", () => {
    const result = insertSections({
      templateHeading: "## T",
      content: "## T\n- [ ] a\n",
      sections: [section(["## T"], ["- [ ] x"])],
    });
    expect(result.content).toBe("## T\n- [ ] a\n- [ ] x\n");
  });
});

