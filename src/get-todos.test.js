import { expect, test } from "vitest";
import {
  getTodos,
  getTodosAndSkipped,
  getSections,
  removeEmptyHeadings,
  insertUnderHeading,
  hasHeading,
} from "./get-todos";

test("single todo element should return itself", () => {
  // GIVEN
  const lines = ["- [ ] tada"];

  // WHEN
  const result = getTodos({ lines });

  // THEN
  const todos = ["- [ ] tada"];
  expect(result).toStrictEqual(todos);
});

test("single incomplete element should return itself", () => {
  // GIVEN
  const lines = ["- [/] tada"];

  // WHEN
  const result = getTodos({ lines });

  // THEN
  const todos = ["- [/] tada"];
  expect(result).toStrictEqual(todos);
});

test("single done todo element should not return itself", () => {
  // GIVEN
  const lines = ["- [x] tada"];

  // WHEN
  const result = getTodos({ lines });

  // THEN
  const todos = [];
  expect(result).toStrictEqual(todos);
});

test("single canceled todo element should not return itself", () => {
  // GIVEN
  const lines = ["- [-] tada"];

  // WHEN
  const result = getTodos({ lines });

  // THEN
  const todos = [];
  expect(result).toStrictEqual(todos);
});

test("get todos with children", function () {
  // GIVEN
  const lines = [
    "- [ ] TODO",
    "    - [ ] Next",
    "    - some stuff",
    "- [ ] Another one",
    "    - [ ] More children",
    "    - another child",
    "- this isn't copied",
  ];

  // WHEN
  const todos = getTodos({ lines: lines, withChildren: true });

  // THEN
  const result = [
    "- [ ] TODO",
    "    - [ ] Next",
    "    - some stuff",
    "- [ ] Another one",
    "    - [ ] More children",
    "    - another child",
  ];
  expect(todos).toStrictEqual(result);
});

test("get todos (with alternate symbols) with children", function () {
  // GIVEN
  const lines = [
    "+ [ ] TODO",
    "    + [ ] Next",
    "    * some stuff",
    "* [ ] Another one",
    "    - [ ] More children",
    "    + another child",
    "- this isn't copied",
  ];

  // WHEN
  const todos = getTodos({ lines: lines, withChildren: true });

  // THEN
  const result = [
    "+ [ ] TODO",
    "    + [ ] Next",
    "    * some stuff",
    "* [ ] Another one",
    "    - [ ] More children",
    "    + another child",
  ];
  expect(todos).toStrictEqual(result);
});

test("get todos (with alternate symbols and partially checked todos) with children", function () {
  // GIVEN
  const lines = [
    "+ [x] Completed TODO",
    "    + [ ] Next",
    "    * some stuff",
    "* [ ] Another one",
    "    - [x] Completed child",
    "    + another child",
    "- this isn't copied",
  ];

  // WHEN
  const todos = getTodos({ lines: lines, withChildren: true });

  // THEN
  const result = [
    "    + [ ] Next",
    "* [ ] Another one",
    "    - [x] Completed child",
    "    + another child",
  ];
  expect(todos).toStrictEqual(result);
});

test("get todos (with custom ✅ done status and 🟣 not-done child status) with children", function () {
  // GIVEN
  const lines = [
    "+ [✅] Completed TODO",
    "    + [🟣] Next",
    "    * some stuff",
    "* [🟣] Another one",
    "    - [✅] Completed child",
    "    + another child",
    "- this isn't copied",
  ];

  // WHEN
  const todos = getTodos({
    lines: lines,
    withChildren: true,
    doneStatusMarkers: "✅",
  });

  // THEN
  const result = [
    "    + [🟣] Next",
    "* [🟣] Another one",
    "    - [✅] Completed child",
    "    + another child",
  ];
  expect(todos).toStrictEqual(result);
});

test("get todos (with default dash prefix and finished todos) with children", function () {
  // GIVEN
  const lines = [
    "- [x] Completed TODO",
    "    - [ ] Next",
    "    * some stuff",
    "- [ ] Another one",
    "    - [x] Completed child",
    "    + another child",
    "* this isn't copied",
  ];

  // WHEN
  const todos = getTodos({ lines: lines, withChildren: true });

  // THEN
  const result = [
    "    - [ ] Next",
    "- [ ] Another one",
    "    - [x] Completed child",
    "    + another child",
  ];
  expect(todos).toStrictEqual(result);
});

test("get todos without children", () => {
  // GIVEN
  const lines = [
    "- [ ] TODO",
    "    - [ ] Next",
    "    - some stuff",
    "- [ ] Another one",
    "    - [ ] More children",
    "    - another child",
    "- this isn't copied",
  ];

  // WHEN
  const todos = getTodos({ lines });

  // THEN
  const result = [
    "- [ ] TODO",
    "    - [ ] Next",
    "- [ ] Another one",
    "    - [ ] More children",
  ];
  expect(todos).toStrictEqual(result);
});

test("get todos without children (with 🟣 not-done child status)", () => {
  // GIVEN
  const lines = [
    "- [ ] TODO",
    "    - [🟣] Next",
    "    - some stuff",
    "- [🟣] Another one",
    "    - [ ] More children",
    "    - another child",
    "- this isn't copied",
  ];

  // WHEN
  const todos = getTodos({ lines });

  // THEN
  const result = [
    "- [ ] TODO",
    "    - [🟣] Next",
    "- [🟣] Another one",
    "    - [ ] More children",
  ];
  expect(todos).toStrictEqual(result);
});

test("get todos with correct alternate checkbox children", function () {
  // GIVEN
  const lines = [
    "- [ ] TODO",
    "    - [ ] Next",
    "    - [x] Completed task",
    "    - some stuff",
    "- [ ] Another one",
    "    - [ ] Another child",
    "    - [/] More children",
    "    - another child",
    "- this isn't copied",
  ];

  // WHEN
  const todos = getTodos({ lines: lines, withChildren: true });

  // THEN
  const result = [
    "- [ ] TODO",
    "    - [ ] Next",
    "    - [x] Completed task",
    "    - some stuff",
    "- [ ] Another one",
    "    - [ ] Another child",
    "    - [/] More children",
    "    - another child",
  ];
  expect(todos).toStrictEqual(result);
});

test("get todos with children doesn't fail if child at end of list", () => {
  // GIVEN
  const lines = [
    "- [ ] TODO",
    "    - [ ] Next",
    "    - some stuff",
    "- [ ] Another one",
    "    - [ ] More children",
    "    - another child",
  ];

  // WHEN
  const todos = getTodos({ lines, withChildren: true });

  // THEN
  const result = [
    "- [ ] TODO",
    "    - [ ] Next",
    "    - some stuff",
    "- [ ] Another one",
    "    - [ ] More children",
    "    - another child",
  ];
  expect(todos).toStrictEqual(result);
});

test("get todos with nested children also adds nested children", () => {
  // GIVEN
  const lines = [
    "- [ ] TODO",
    "    - [ ] Next",
    "    - some stuff",
    "        - some stuff",
    "        - some stuff",
    "- [ ] Another one",
    "    - [ ] More children",
    "    - another child",
  ];

  // WHEN
  const todos = getTodos({ lines, withChildren: true });

  // THEN
  const result = [
    "- [ ] TODO",
    "    - [ ] Next",
    "    - some stuff",
    "        - some stuff",
    "        - some stuff",
    "- [ ] Another one",
    "    - [ ] More children",
    "    - another child",
  ];
  expect(todos).toStrictEqual(result);
});

test("get todos doesn't add intermediate other elements", () => {
  // GIVEN
  const lines = [
    "# Some title",
    "",
    "- [ ] TODO",
    "    - [ ] Next",
    "    - some stuff",
    "",
    "## Some title",
    "",
    "Some text",
    "...that continues here",
    "",
    "- Here is a bullet item",
    "- Here is another bullet item",
    "1. Here is a numbered list item",
    "- [ ] Another one",
    "    - [ ] More children",
    "    - another child",
  ];

  // WHEN
  const todos = getTodos({ lines, withChildren: true });

  // THEN
  const result = [
    "- [ ] TODO",
    "    - [ ] Next",
    "    - some stuff",
    "- [ ] Another one",
    "    - [ ] More children",
    "    - another child",
  ];
  expect(todos).toStrictEqual(result);
});

test("get todos supports custom done status markers", () => {
  // GIVEN
  const lines = [
    "- [ ] Incomplete task",
    "- [x] Completed task (x)",
    "- [X] Completed task (X)",
    "- [-] Completed task (-)",
    "- [C] Task with custom status (C)",
    "- [?] Task with custom status (?)",
  ];

  // WHEN - only consider 'C' and '?' as done
  const todos = getTodos({ lines, doneStatusMarkers: "C?" });

  // THEN - x, X, and - should be considered incomplete now
  const result = [
    "- [ ] Incomplete task",
    "- [x] Completed task (x)",
    "- [X] Completed task (X)",
    "- [-] Completed task (-)",
  ];
  expect(todos).toStrictEqual(result);
});

test("get todos supports custom status marker edge cases (exclusion)", () => {
  // GIVEN
  const lines = [
    "- [ ] Normal task",
    // Emojis and symbols
    "- [✅] Checkmark emoji",
    "- [❌] Cross emoji",
    "- [✔️] Heavy checkmark",
    "- [✓] Checkmark symbol",
    "- [✗] Ballot X",
    "- [👍] Thumbs up",
    // Control and non-printable characters
    "- [\u0000] Null",
    "- [\u0007] Bell",
    "- [\u0008] Backspace",
    "- [\u001B] Escape",
    // Combining characters
    "- [a\u0300] Letter with accent",
    "- [e\u0301] Letter with acute",
    // Regex special characters
    "- [.] Dot",
    "- [*] Star",
    "- [+] Plus",
    "- [?] Question",
    "- [(] Open paren",
    "- [)] Close paren",
    "- [[] Open bracket",
    "- []] Close bracket",
    "- [{] Open brace",
    "- [}] Close brace",
    "- [^] Caret",
    "- [$] Dollar",
    "- [|] Pipe",
    "- [\\] Backslash",
    "- [/] Forward slash",
    // Simple accented characters (should be valid)
    "- [à] Simple accented character",
    "- [é] Simple accented character 2",
  ];

  // WHEN - using all types of characters as done markers
  const todos = getTodos({
    lines,
    doneStatusMarkers:
      "✅❌✔️✓✗👍\u0000\u0007\u0008\u001B\u202Ea\u0300e\u0301.*+?()[]{}\\^$|/àé",
  });

  // THEN - only the normal task should be returned
  const result = ["- [ ] Normal task"];
  expect(todos).toStrictEqual(result);
});

test("get todos supports custom status marker edge cases (inclusion)", () => {
  // GIVEN
  const lines = [
    "- [ ] Normal task",
    // Emojis and symbols
    "- [✅] Checkmark emoji",
    "- [❌] Cross emoji",
    "- [✔️] Heavy checkmark",
    "- [✓] Checkmark symbol",
    "- [✗] Ballot X",
    "- [👍] Thumbs up",
    // Control and non-printable characters
    "- [\u0000] Null",
    "- [\u0007] Bell",
    "- [\u0008] Backspace",
    "- [\u001B] Escape",
    // Combining characters
    "- [a\u0300] Letter with accent",
    "- [e\u0301] Letter with acute",
    // Regex special characters
    "- [.] Dot",
    "- [*] Star",
    "- [+] Plus",
    "- [?] Question",
    "- [(] Open paren",
    "- [)] Close paren",
    "- [[] Open bracket",
    "- []] Close bracket",
    "- [{] Open brace",
    "- [}] Close brace",
    "- [^] Caret",
    "- [$] Dollar",
    "- [|] Pipe",
    "- [\\] Backslash",
    "- [/] Forward slash",
    // Simple accented characters (should be valid)
    "- [à] Simple accented character",
    "- [é] Simple accented character 2",
  ];

  // WHEN - only consider 'C' as done
  const todos = getTodos({ lines, doneStatusMarkers: "C" });

  // THEN - only the normal task should be returned
  const result = [
    "- [ ] Normal task",
    // Emojis and symbols
    "- [✅] Checkmark emoji",
    "- [❌] Cross emoji",
    "- [✔️] Heavy checkmark",
    "- [✓] Checkmark symbol",
    "- [✗] Ballot X",
    "- [👍] Thumbs up",
    // Control and non-printable characters
    "- [\u0000] Null",
    "- [\u0007] Bell",
    "- [\u0008] Backspace",
    "- [\u001B] Escape",
    // Combining characters
    "- [a\u0300] Letter with accent",
    "- [e\u0301] Letter with acute",
    // Regex special characters
    "- [.] Dot",
    "- [*] Star",
    "- [+] Plus",
    "- [?] Question",
    "- [(] Open paren",
    "- [)] Close paren",
    "- [[] Open bracket",
    "- []] Close bracket",
    "- [{] Open brace",
    "- [}] Close brace",
    "- [^] Caret",
    "- [$] Dollar",
    "- [|] Pipe",
    "- [\\] Backslash",
    "- [/] Forward slash",
    // Simple accented characters (should be valid)
    "- [à] Simple accented character",
    "- [é] Simple accented character 2",
  ];
  expect(todos).toStrictEqual(result);
});

test("should not match malformed todos", () => {
  const lines = [
    "- [ ] valid todo",
    "- [x] done", // done, should NOT match
    // Malformed, should not match
    "- [] empty",
    "- [  ] multiple spaces",
    "- [✅\u200B\u0300] multiple special",
    "- [.*+?()] multiple regexp",
    "- [a\u0300\u200B] multimple combining",
    // Grapheme modifiers, not valid on their own
    "- [\u202E] RTL override",
    "- [\u200B] Zero-width space",
    "- [\u200C] Zero-width non-joiner",
    "- [\u200D] Zero-width joiner",
  ];
  const todos = getTodos({ lines });
  expect(todos).toStrictEqual(["- [ ] valid todo"]);
});

// ─── getSections ────────────────────────────────────────────────────────────

test("getSections returns empty array when no todos exist", () => {
  const lines = ["## Notes", "", "some text", "- not a todo"];
  expect(getSections({ lines })).toStrictEqual([]);
});

test("getSections groups incomplete todos under their direct parent heading", () => {
  const lines = [
    "## Notes",
    "",
    "### Today's intent",
    "- [ ] task1",
    "",
    "#### Personal Projects",
    "",
    "- [x] Setup SSO",
    "- [ ] Create browser extension",
    "",
    "#### IRAP",
    "",
    "- [x] Review AI controls",
    "- [ ] Organize call",
  ];

  const sections = getSections({ lines, doneStatusMarkers: "xX-" });

  expect(sections).toStrictEqual([
    { headingPath: ["## Notes", "### Today's intent"], incompleteTodos: ["- [ ] task1"], incompleteLineIndices: [3] },
    { headingPath: ["## Notes", "### Today's intent", "#### Personal Projects"], incompleteTodos: ["- [ ] Create browser extension"], incompleteLineIndices: [8] },
    { headingPath: ["## Notes", "### Today's intent", "#### IRAP"], incompleteTodos: ["- [ ] Organize call"], incompleteLineIndices: [13] },
  ]);
});

test("getSections excludes sections with only completed todos", () => {
  const lines = [
    "#### All done",
    "- [x] done1",
    "- [x] done2",
    "#### Has todos",
    "- [ ] still open",
  ];

  const sections = getSections({ lines, doneStatusMarkers: "xX-" });

  expect(sections).toStrictEqual([
    { headingPath: ["#### Has todos"], incompleteTodos: ["- [ ] still open"], incompleteLineIndices: [4] },
  ]);
});

test("getSections puts todos before any heading into empty headingPath", () => {
  const lines = [
    "- [ ] floating todo",
    "- [x] done",
    "## Notes",
    "- [ ] under heading",
  ];

  const sections = getSections({ lines, doneStatusMarkers: "xX-" });

  expect(sections).toStrictEqual([
    { headingPath: [], incompleteTodos: ["- [ ] floating todo"], incompleteLineIndices: [0] },
    { headingPath: ["## Notes"], incompleteTodos: ["- [ ] under heading"], incompleteLineIndices: [3] },
  ]);
});

test("getSections respects withChildren option", () => {
  const lines = [
    "#### IRAP",
    "- [ ] Setup meeting - @person",
    "    - [i] Sent notes",
    "- [ ] Organize call",
  ];

  const sections = getSections({ lines, withChildren: true, doneStatusMarkers: "xX" });

  expect(sections).toStrictEqual([
    {
      headingPath: ["#### IRAP"],
      incompleteTodos: [
        "- [ ] Setup meeting - @person",
        "    - [i] Sent notes",
        "- [ ] Organize call",
      ],
      incompleteLineIndices: [1, 2, 3],
    },
  ]);
});

test("getSections respects custom doneStatusMarkers", () => {
  const lines = [
    "#### Section",
    "- [b] blocked task",
    "- [ ] open task",
    "- [x] done task",
  ];

  const sections = getSections({ lines, doneStatusMarkers: "xXb" });

  expect(sections).toStrictEqual([
    { headingPath: ["#### Section"], incompleteTodos: ["- [ ] open task"], incompleteLineIndices: [2] },
  ]);
});

test("getSections handles multiple headings at same level independently", () => {
  const lines = [
    "#### Section A",
    "- [ ] todo A",
    "#### Section B",
    "- [ ] todo B",
  ];

  const sections = getSections({ lines });

  expect(sections).toStrictEqual([
    { headingPath: ["#### Section A"], incompleteTodos: ["- [ ] todo A"], incompleteLineIndices: [1] },
    { headingPath: ["#### Section B"], incompleteTodos: ["- [ ] todo B"], incompleteLineIndices: [3] },
  ]);
});

test("getSections includes full heading ancestry for deeply nested todos", () => {
  const lines = [
    "### Today's intent",
    "#### Personal projects",
    "##### Seal workflow",
    "- [x] Fix renovate workflow",
    "- [/] Adopt temporal for orchestration",
  ];

  const sections = getSections({ lines, doneStatusMarkers: "xX" });

  expect(sections).toStrictEqual([
    {
      headingPath: ["### Today's intent", "#### Personal projects", "##### Seal workflow"],
      incompleteTodos: ["- [/] Adopt temporal for orchestration"],
      incompleteLineIndices: [4],
    },
  ]);
});

test("getSections resets ancestry correctly when sibling headings are encountered", () => {
  const lines = [
    "#### Section A",
    "##### Sub A",
    "- [ ] todo under Sub A",
    "#### Section B",
    "- [ ] todo under Section B",
  ];

  const sections = getSections({ lines });

  expect(sections).toStrictEqual([
    { headingPath: ["#### Section A", "##### Sub A"], incompleteTodos: ["- [ ] todo under Sub A"], incompleteLineIndices: [2] },
    { headingPath: ["#### Section B"], incompleteTodos: ["- [ ] todo under Section B"], incompleteLineIndices: [4] },
  ]);
});

// ─── removeEmptyHeadings ────────────────────────────────────────────────────

test("removeEmptyHeadings returns lines unchanged when no headings present", () => {
  const lines = ["- [x] done", "some text"];
  expect(removeEmptyHeadings(lines)).toStrictEqual(lines);
});

test("removeEmptyHeadings removes heading whose section is only blank lines", () => {
  const lines = [
    "### Empty section",
    "",
    "",
    "### Non-empty section",
    "- [x] done",
  ];
  expect(removeEmptyHeadings(lines)).toStrictEqual([
    "### Non-empty section",
    "- [x] done",
  ]);
});

test("removeEmptyHeadings keeps heading that has content directly under it", () => {
  const lines = ["### Section", "- [x] done"];
  expect(removeEmptyHeadings(lines)).toStrictEqual(["### Section", "- [x] done"]);
});

test("removeEmptyHeadings removes parent heading when all sub-sections are empty", () => {
  const lines = [
    "### Parent",
    "#### Child 1",
    "",
    "#### Child 2",
    "",
    "## Unrelated",
    "- [x] content",
  ];
  expect(removeEmptyHeadings(lines)).toStrictEqual(["## Unrelated", "- [x] content"]);
});

test("removeEmptyHeadings keeps parent heading when a sub-section has content", () => {
  const lines = [
    "### Parent",
    "#### Child 1",
    "- [x] done",
    "#### Child 2",
    "",
  ];
  expect(removeEmptyHeadings(lines)).toStrictEqual([
    "### Parent",
    "#### Child 1",
    "- [x] done",
  ]);
});

test("removeEmptyHeadings keeps parent heading when it has direct non-todo content", () => {
  const lines = [
    "### Parent",
    "some paragraph text",
    "#### Child",
    "",
  ];
  expect(removeEmptyHeadings(lines)).toStrictEqual([
    "### Parent",
    "some paragraph text",
  ]);
});

// ─── insertUnderHeading ─────────────────────────────────────────────────────

test("insertUnderHeading inserts text right after heading when section is empty", () => {
  const content = "### Today's intent\n\n### Other section\n";
  const result = insertUnderHeading(content, "### Today's intent", "- [ ] new todo");
  expect(result).toBe("### Today's intent\n- [ ] new todo\n\n### Other section\n");
});

test("insertUnderHeading appends after existing section content", () => {
  const content = "### Today's intent\n- [ ] existing\n\n### Other section\n";
  const result = insertUnderHeading(content, "### Today's intent", "- [ ] new todo");
  expect(result).toBe("### Today's intent\n- [ ] existing\n- [ ] new todo\n\n### Other section\n");
});

test("insertUnderHeading inserts at end of section including sub-headings", () => {
  const content = "### Today's intent\n\n#### Sub\n- [x] done\n\n### Other\n";
  const result = insertUnderHeading(content, "### Today's intent", "#### New sub\n- [ ] todo");
  expect(result).toBe("### Today's intent\n\n#### Sub\n- [x] done\n#### New sub\n- [ ] todo\n\n### Other\n");
});

test("insertUnderHeading falls back to end of file when heading not found", () => {
  const content = "## Notes\n\nsome content\n";
  const result = insertUnderHeading(content, "### Missing heading", "- [ ] todo");
  expect(result).toBe("## Notes\n\nsome content\n- [ ] todo\n");
});

test("insertUnderHeading matches heading case-insensitively", () => {
  // Today's note may capitalise the heading differently from yesterday's
  const content = "#### Personal Projects\n\n#### Other\n";
  const result = insertUnderHeading(content, "#### personal projects", "- [ ] todo");
  expect(result).toBe("#### Personal Projects\n- [ ] todo\n\n#### Other\n");
});

test("insertUnderHeading still respects heading level when matching case-insensitively", () => {
  // "#### Notes" in today and "### Notes" should NOT match (different level)
  const content = "### Notes\n- [x] done\n\n#### Notes\n\n";
  const result = insertUnderHeading(content, "#### notes", "- [ ] todo");
  // todo lands under #### Notes (not ### Notes); trailing blank line follows the insert
  expect(result).toBe("### Notes\n- [x] done\n\n#### Notes\n\n- [ ] todo\n");
});

test("insertUnderHeading with leadingNewLine adds blank line before inserted text", () => {
  const content = "### Today's intent\n";
  const result = insertUnderHeading(content, "### Today's intent", "- [ ] todo", true);
  expect(result).toBe("### Today's intent\n\n- [ ] todo\n");
});

// ─── anchored todo regex ────────────────────────────────────────────────────

test("bullet pattern in the middle of a line is not a todo", () => {
  const lines = ["const s = `- [ ] ${item}`;", "see - [ ] foo"];
  expect(getTodos({ lines })).toStrictEqual([]);
});

test("indented todos and blockquoted todos are still found by default", () => {
  const lines = ["    - [ ] indented", "> - [ ] quoted", "\t* [ ] star"];
  expect(getTodos({ lines })).toStrictEqual(lines);
});

// ─── ignoreBlockquotes ──────────────────────────────────────────────────────

test("ignoreBlockquotes skips todos inside blockquotes and callouts", () => {
  const lines = ["> [!tip]", "> - [ ] habit", "  > - [ ] indented habit", "- [ ] real"];
  expect(getTodos({ lines, ignoreBlockquotes: true })).toStrictEqual(["- [ ] real"]);
});

test("ignoreBlockquotes is off by default", () => {
  const lines = ["> - [ ] habit"];
  expect(getTodos({ lines })).toStrictEqual(lines);
});

// ─── skipCompletedChildren ──────────────────────────────────────────────────

test("skipCompletedChildren drops completed children and their descendants", () => {
  const lines = [
    "- [ ] parent",
    "    - [x] done child",
    "        - nested note",
    "    - [ ] open child",
    "    - plain note",
    "- [ ] next",
  ];
  expect(
    getTodos({ lines, withChildren: true, skipCompletedChildren: true })
  ).toStrictEqual([
    "- [ ] parent",
    "    - [ ] open child",
    "    - plain note",
    "- [ ] next",
  ]);
});

test("completed children are kept when skipCompletedChildren is off", () => {
  const lines = ["- [ ] parent", "    - [x] done child", "        - nested"];
  expect(getTodos({ lines, withChildren: true })).toStrictEqual(lines);
});

test("skipCompletedChildren respects custom doneStatusMarkers", () => {
  const lines = ["- [ ] parent", "    - [?] done child", "    - [ ] open"];
  expect(
    getTodos({
      lines,
      withChildren: true,
      skipCompletedChildren: true,
      doneStatusMarkers: "xX?",
    })
  ).toStrictEqual(["- [ ] parent", "    - [ ] open"]);
});

test("skipCompletedChildren does not re-read skipped lines as top-level todos", () => {
  // the skipped subtree has only non-todo content; none of it may roll on its own
  const lines = [
    "- [ ] parent",
    "    - [x] done child",
    "        - plain note",
    "        - [x] done grandchild",
    "- [ ] next",
  ];
  expect(
    getTodos({ lines, withChildren: true, skipCompletedChildren: true })
  ).toStrictEqual(["- [ ] parent", "- [ ] next"]);
});

test("skipCompletedChildren keeps a completed child that still has open todos under it", () => {
  const lines = [
    "- [ ] parent",
    "    - [x] done child",
    "        - [ ] open grandchild",
    "        - [x] done grandchild",
    "- [ ] next",
  ];
  expect(
    getTodosAndSkipped({ lines, withChildren: true, skipCompletedChildren: true })
  ).toStrictEqual({
    todos: [
      "- [ ] parent",
      "    - [x] done child",
      "        - [ ] open grandchild",
      "- [ ] next",
    ],
    todoIndices: [0, 1, 2, 4],
    skippedIndices: [3],
  });
});

test("skipCompletedChildren has no effect without withChildren", () => {
  const lines = ["- [ ] parent", "    - [x] done child"];
  expect(getTodos({ lines, skipCompletedChildren: true })).toStrictEqual([
    "- [ ] parent",
  ]);
});

test("getTodosAndSkipped reports the indices of skipped lines", () => {
  const lines = [
    "- [x] top done",
    "- [ ] parent",
    "    - [x] done child",
    "        - nested note",
    "    - [ ] open child",
  ];
  expect(
    getTodosAndSkipped({ lines, withChildren: true, skipCompletedChildren: true })
  ).toStrictEqual({
    todos: ["- [ ] parent", "    - [ ] open child"],
    todoIndices: [1, 4],
    skippedIndices: [2, 3],
  });
});

test("getSections forwards parser options and reports absolute skipped line indices", () => {
  const lines = [
    "## Work",
    "- [ ] Ship release",
    "    - [x] Write changelog",
    "        - covers breaking changes",
    "    - [ ] Tag version",
    "> - [ ] habit",
    "## Home",
    "- [ ] Laundry",
    "    - [x] Sort",
  ];
  expect(
    getSections({
      lines,
      withChildren: true,
      ignoreBlockquotes: true,
      skipCompletedChildren: true,
    })
  ).toStrictEqual([
    {
      headingPath: ["## Work"],
      incompleteTodos: ["- [ ] Ship release", "    - [ ] Tag version"],
      incompleteLineIndices: [1, 4],
      skippedLineIndices: [2, 3],
    },
    {
      headingPath: ["## Home"],
      incompleteTodos: ["- [ ] Laundry"],
      incompleteLineIndices: [7],
      skippedLineIndices: [8],
    },
  ]);
});

test("insertUnderHeading keeps lines apart when the section is at the end of a file with no trailing newline", () => {
  const result = insertUnderHeading("## Tasks\n- [ ] a", "## Tasks", "- [ ] x", false);
  expect(result).toBe("## Tasks\n- [ ] a\n- [ ] x\n");
});

test("insertUnderHeading keeps the heading and todo apart when the next heading follows directly", () => {
  const result = insertUnderHeading("## Tasks\n## Notes\n", "## Tasks", "- [ ] x", false);
  expect(result).toBe("## Tasks\n- [ ] x\n\n## Notes\n");
});

test("insertUnderHeading fallback separates text from a last line without a newline", () => {
  const result = insertUnderHeading("hello", "## Tasks", "- [ ] x", false);
  expect(result).toBe("hello\n- [ ] x\n");
});

test("insertUnderHeading fallback on an empty note adds no leading blank line", () => {
  const result = insertUnderHeading("", "## Tasks", "- [ ] x", false);
  expect(result).toBe("- [ ] x\n");
});

test("hasHeading finds a heading line case-insensitively", () => {
  expect(hasHeading("## Notes\n\n## Tasks\n", "## tasks")).toBe(true);
});

test("hasHeading is false when the heading is missing or only part of a line", () => {
  expect(hasHeading("## Notes\n", "## Tasks")).toBe(false);
  expect(hasHeading("see ## Tasks here\n", "## Tasks")).toBe(false);
});

test("hasHeading treats regex characters in the heading literally", () => {
  expect(hasHeading("## Tasks (today)\n", "## Tasks (today)")).toBe(true);
  expect(hasHeading("## Tasks today\n", "## Tasks (today)")).toBe(false);
});

test("insertUnderHeading with a target that is not a Markdown heading inserts at the end of its section", () => {
  const content = "Tasks\n- [ ] a\n\n## Notes\ntext\n";
  const result = insertUnderHeading(content, "Tasks", "- [ ] x", false);
  expect(result).toBe("Tasks\n- [ ] a\n- [ ] x\n\n## Notes\ntext\n");
});

test("insertUnderHeading with beforeSubHeadings inserts before the first sub-heading", () => {
  const content = "# Work\n- [ ] a\n\n## Home\n- [ ] b\n";
  const result = insertUnderHeading(content, "# Work", "- [ ] x", false, {
    beforeSubHeadings: true,
  });
  expect(result).toBe("# Work\n- [ ] a\n- [ ] x\n\n## Home\n- [ ] b\n");
});

test("insertUnderHeading with beforeSubHeadings still goes to the end when there are none", () => {
  const result = insertUnderHeading("# Work\n- [ ] a\n", "# Work", "- [ ] x", false, {
    beforeSubHeadings: true,
  });
  expect(result).toBe("# Work\n- [ ] a\n- [ ] x\n");
});

test("insertUnderHeading adds the blank line after an empty heading whatever the section ends with", () => {
  // the next heading follows directly, so the section has no trailing newline
  const result = insertUnderHeading("## Tasks\n## Next", "## Tasks", "- [ ] x", true);
  expect(result).toBe("## Tasks\n\n- [ ] x\n\n## Next");
});

test("insertUnderHeading appends directly after existing todos, without a blank line", () => {
  const content = "## Tasks\n\n- [ ] a\n  - [ ] b\n\n## Next\n";
  const result = insertUnderHeading(content, "## Tasks", "- [ ] x", true);
  expect(result).toBe("## Tasks\n\n- [ ] a\n  - [ ] b\n- [ ] x\n\n## Next\n");
});

test("insertUnderHeading appends after existing todos at the end of a note without a final newline", () => {
  const result = insertUnderHeading("## Tasks\n- [ ] a", "## Tasks", "- [ ] x", true);
  expect(result).toBe("## Tasks\n- [ ] a\n- [ ] x\n");
});

test("insertUnderHeading puts a blank line before a new sub-heading when leadingNewLine is on", () => {
  const content = "## Tasks\n\n- [ ] a\n\n## Next\n";
  expect(insertUnderHeading(content, "## Tasks", "### Sub\n- [ ] x", true)).toBe(
    "## Tasks\n\n- [ ] a\n\n### Sub\n- [ ] x\n\n## Next\n"
  );
  expect(insertUnderHeading(content, "## Tasks", "### Sub\n- [ ] x", false)).toBe(
    "## Tasks\n\n- [ ] a\n### Sub\n- [ ] x\n\n## Next\n"
  );
});

test("insertUnderHeading fallback adds the blank line for leadingNewLine after a last line without newline", () => {
  expect(insertUnderHeading("hello", "## Tasks", "- [ ] x", true)).toBe("hello\n\n- [ ] x\n");
});
