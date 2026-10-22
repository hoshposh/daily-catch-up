import { describe, expect, test } from "vitest";
import { extractHeadings, headingOptions } from "./template-headings";

describe("extractHeadings", () => {
  test("returns every heading line of the template", () => {
    const contents = "# Day\n\n## Tasks\n- [ ] x\n\n### Notes\ntext\n";
    expect(extractHeadings(contents)).toStrictEqual(["# Day", "## Tasks", "### Notes"]);
  });

  test("returns an empty list when the template has no headings", () => {
    expect(extractHeadings("just text\n- [ ] x\n")).toStrictEqual([]);
  });

  test("handles CRLF without keeping the carriage return", () => {
    expect(extractHeadings("## Tasks\r\n- [ ] x\r\n")).toStrictEqual(["## Tasks"]);
  });
});

describe("headingOptions", () => {
  test("maps headings to dropdown options and appends None", () => {
    expect(headingOptions(["## Tasks", "## Notes"], "## Tasks")).toStrictEqual({
      "## Tasks": "## Tasks",
      "## Notes": "## Notes",
      none: "None",
    });
  });

  test("keeps a saved heading that is no longer in the template", () => {
    expect(headingOptions(["## Tasks"], "## Old")).toStrictEqual({
      "## Tasks": "## Tasks",
      "## Old": "## Old",
      none: "None",
    });
  });

  test("does not add 'none' or an empty value as a heading", () => {
    expect(headingOptions(["## Tasks"], "none")).toStrictEqual({
      "## Tasks": "## Tasks",
      none: "None",
    });
    expect(headingOptions(["## Tasks"], undefined)).toStrictEqual({
      "## Tasks": "## Tasks",
      none: "None",
    });
  });
});
