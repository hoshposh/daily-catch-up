class TodoParser {
  // Support all unordered list bullet symbols as per spec (https://daringfireball.net/projects/markdown/syntax#list)
  bulletSymbols = ["-", "*", "+"];

  // Default completed status markers
  doneStatusMarkers = ["x", "X", "-"];

  // List of strings that include the Markdown content
  #lines;

  // Boolean that encodes whether nested items should be rolled over
  #withChildren;

  // When true, lines whose first non-whitespace char is `>` (blockquotes and
  // callouts such as `> [!tip]`) are never treated as todos
  #ignoreBlockquotes;

  // When true, completed-todo children (and all their descendants) are left
  // out when rolling over children. Only meaningful with #withChildren.
  #skipCompletedChildren;

  // Indices (into #lines) of child lines that were left out by
  // #skipCompletedChildren, so callers can clean them up alongside the parent
  #skippedIndices = [];

  // Parse content with segmentation to allow for Unicode grapheme clusters
  #parseIntoChars(content, contentType = "content") {
    // Use Intl.Segmenter to properly split grapheme clusters if available,
    // otherwise fall back to Array.from. The fallback should not trigger in
    // Obsidian since it uses Electron which supports Intl.Segmenter.
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
      return Array.from(segmenter.segment(content), (s) => s.segment);
    } else {
      // Array.from() splits surrogate pairs correctly but not complex grapheme clusters
      // (e.g., 👨‍👩‍👧‍👦 would be split incorrectly) and fail to match.
      console.error(
        `Intl.Segmenter not available, falling back to Array.from() for ${contentType}`
      );
      return Array.from(content);
    }
  }

  constructor(
    lines,
    withChildren,
    doneStatusMarkers,
    ignoreBlockquotes,
    skipCompletedChildren
  ) {
    this.#lines = lines;
    this.#withChildren = withChildren;
    this.#ignoreBlockquotes = !!ignoreBlockquotes;
    this.#skipCompletedChildren = !!skipCompletedChildren;
    if (doneStatusMarkers) {
      this.doneStatusMarkers = this.#parseIntoChars(
        doneStatusMarkers,
        "done status markers"
      );
    }
  }

  // Returns the grapheme clusters inside the checkbox of list item `s`, or
  // null if `s` is not a checkbox item or the content is not a single grapheme
  #checkboxChars(s) {
    if (this.#ignoreBlockquotes && /^\s*>/.test(s)) {
      return null;
    }

    // Anchored to the start of the line so bullet-like text inside code blocks
    // or template literals is not matched. Blockquote prefixes are allowed so
    // that #ignoreBlockquotes alone decides whether callout todos count.
    const match = s.match(/^\s*(?:>\s*)*[*+-] \[(.+?)\]/);
    if (!match) return null;

    // Parse content with segmentation to allow for Unicode grapheme clusters
    const contentChars = this.#parseIntoChars(match[1], "checkbox content");

    // Valid checkbox content must be exactly one grapheme cluster
    return contentChars.length === 1 ? contentChars : null;
  }

  // Returns true if string s is a completed todo-item
  #isDoneTodo(s) {
    const contentChars = this.#checkboxChars(s);
    if (!contentChars) return false;
    return contentChars.some((char) => this.doneStatusMarkers.includes(char));
  }

  // Returns true if string s is a todo-item
  #isTodo(s) {
    const contentChars = this.#checkboxChars(s);
    if (!contentChars) return false;

    const singleChar = contentChars[0];

    // Exclude grapheme modifiers that are not valid as standalone content
    const graphemeModifiers = ['\u202E', '\u200B', '\u200C', '\u200D'];
    const hasGraphemeModifier = contentChars.some((char) =>
      graphemeModifiers.includes(char)
    );
    if (hasGraphemeModifier) {
      return false;
    }

    // Check if the checkbox content contains any characters that are in doneStatusMarkers
    const hasDoneMarker = contentChars.some((char) =>
      this.doneStatusMarkers.includes(char)
    );

    // Return true (is a todo) if it does NOT contain any done markers
    return !hasDoneMarker;
  }

  // Returns true if line after line-number `l` is a nested item
  #hasChildren(l) {
    if (l + 1 >= this.#lines.length) {
      return false;
    }
    const indCurr = this.#getIndentation(l);
    const indNext = this.#getIndentation(l + 1);
    if (indNext > indCurr) {
      return true;
    }
    return false;
  }

  // Returns the nested items to include after line `parentLinum`, plus the
  // number of source lines walked (more than children.length when completed
  // children are skipped)
  #getChildren(parentLinum) {
    const children = [];
    let nextLinum = parentLinum + 1;
    while (this.#isChildOf(parentLinum, nextLinum)) {
      if (
        this.#skipCompletedChildren &&
        this.#isDoneTodo(this.#lines[nextLinum])
      ) {
        // Drop the completed child together with everything nested under it
        const childIndentation = this.#getIndentation(nextLinum);
        this.#skippedIndices.push(nextLinum);
        nextLinum++;
        while (
          nextLinum < this.#lines.length &&
          this.#getIndentation(nextLinum) > childIndentation
        ) {
          this.#skippedIndices.push(nextLinum);
          nextLinum++;
        }
        continue;
      }
      children.push(this.#lines[nextLinum]);
      nextLinum++;
    }
    return { children, consumed: nextLinum - parentLinum - 1 };
  }

  // Returns true if line `linum` has more indentation than line `parentLinum`
  #isChildOf(parentLinum, linum) {
    if (parentLinum >= this.#lines.length || linum >= this.#lines.length) {
      return false;
    }
    return this.#getIndentation(linum) > this.#getIndentation(parentLinum);
  }

  // Returns the number of whitespace-characters at beginning of string at line `l`
  #getIndentation(l) {
    return this.#lines[l].search(/\S/);
  }

  // Returns a list of strings that represents all the todos along with there potential children
  getTodos() {
    let todos = [];
    for (let l = 0; l < this.#lines.length; l++) {
      const line = this.#lines[l];
      if (this.#isTodo(line)) {
        todos.push(line);
        if (this.#withChildren && this.#hasChildren(l)) {
          const { children, consumed } = this.#getChildren(l);
          todos = [...todos, ...children];
          l += consumed;
        }
      }
    }
    return todos;
  }

  // Indices of the child lines left out by #skipCompletedChildren. Only
  // meaningful after getTodos() has run.
  getSkippedIndices() {
    return this.#skippedIndices;
  }
}

// Utility-function that acts as a thin wrapper around `TodoParser`
export const getTodos = (options) => getTodosAndSkipped(options).todos;

// Like `getTodos`, but also returns `skippedIndices`: the indices (into
// `lines`) of completed children left out by `skipCompletedChildren`.
export const getTodosAndSkipped = ({
  lines,
  withChildren = false,
  doneStatusMarkers = null,
  ignoreBlockquotes = false,
  skipCompletedChildren = false,
}) => {
  const todoParser = new TodoParser(
    lines,
    withChildren,
    doneStatusMarkers,
    ignoreBlockquotes,
    skipCompletedChildren
  );
  const todos = todoParser.getTodos();
  return { todos, skippedIndices: todoParser.getSkippedIndices() };
};

// Returns the heading level (1-6) for a line like "## Foo", or null if not a heading
function getHeadingLevel(line) {
  const match = line.match(/^(#{1,6}) /);
  return match ? match[1].length : null;
}

// Returns sections from `lines` that have incomplete todos, each with the full ancestor
// heading chain. Each section is { headingPath: string[], incompleteTodos: string[] }
// where headingPath is ordered from outermost to innermost heading.
//
// When skipCompletedChildren leaves lines out, the section also carries
// `skippedLineIndices`: their indices in `lines`, so they can be removed from
// the source note along with their rolled parent. The key is omitted otherwise.
export const getSections = ({
  lines,
  withChildren = false,
  doneStatusMarkers = null,
  ignoreBlockquotes = false,
  skipCompletedChildren = false,
}) => {
  const sections = [];
  const headingStack = []; // [{ heading: string, level: number }]
  let sectionLines = [];
  let sectionStart = 0; // index in `lines` of sectionLines[0]

  const finalizeSection = () => {
    const { todos: incompleteTodos, skippedIndices } = getTodosAndSkipped({
      lines: sectionLines,
      withChildren,
      doneStatusMarkers,
      ignoreBlockquotes,
      skipCompletedChildren,
    });
    if (incompleteTodos.length > 0) {
      const section = {
        headingPath: headingStack.map((h) => h.heading),
        incompleteTodos,
      };
      if (skippedIndices.length > 0) {
        section.skippedLineIndices = skippedIndices.map((i) => sectionStart + i);
      }
      sections.push(section);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const level = getHeadingLevel(line);
    if (level !== null) {
      finalizeSection();
      sectionStart = i + 1;
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ heading: line, level });
      sectionLines = [];
    } else {
      sectionLines.push(line);
    }
  }
  finalizeSection();

  return sections;
};

// Removes heading lines whose entire section (direct content + sub-sections recursively)
// contains no non-blank content after incomplete todos have been removed.
export const removeEmptyHeadings = (lines) => {
  const [result] = processSection(lines, 0, 0);
  return result;
};

// Returns [filteredLines, nextIndex]. Processes lines starting at startIdx,
// stopping when a heading at level <= parentLevel is encountered.
function processSection(lines, startIdx, parentLevel) {
  const result = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    const level = getHeadingLevel(line);

    if (level !== null && level <= parentLevel) {
      break;
    }

    if (level !== null) {
      const [sectionContent, nextI] = processSection(lines, i + 1, level);
      if (sectionContent.some((l) => l.trim() !== "")) {
        result.push(line);
        result.push(...sectionContent);
      }
      i = nextI;
    } else {
      result.push(line);
      i++;
    }
  }

  return [result, i];
}

// Inserts textToInsert into noteContent right before the next heading at the same
// or higher level as targetHeading (fewer or equal # signs). Falls back to appending
// at end of file if targetHeading is not found. leadingNewLine adds a blank line before
// the inserted text.
export const insertUnderHeading = (
  noteContent,
  targetHeading,
  textToInsert,
  leadingNewLine = false
) => {
  const escapedHeading = targetHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingLineRegex = new RegExp(`^${escapedHeading}$`, "mi");
  const headingMatch = headingLineRegex.exec(noteContent);

  // Text added after a line that has no newline of its own would be glued to
  // that line, so a separator is needed (this also covers leadingNewLine)
  const needsSeparator = (before) => before !== "" && !before.endsWith("\n");

  if (!headingMatch) {
    const prefix = leadingNewLine || needsSeparator(noteContent) ? "\n" : "";
    return noteContent + prefix + textToInsert + "\n";
  }

  const level = getHeadingLevel(targetHeading);
  const searchStart = headingMatch.index + headingMatch[0].length;

  const nextHeadingRegex = new RegExp(`\\n#{1,${level}} `, "g");
  nextHeadingRegex.lastIndex = searchStart;
  const nextMatch = nextHeadingRegex.exec(noteContent);

  const insertionPoint = nextMatch !== null ? nextMatch.index : noteContent.length;
  const before = noteContent.slice(0, insertionPoint);
  const prefix = leadingNewLine || needsSeparator(before) ? "\n" : "";

  return (
    before +
    prefix +
    textToInsert +
    "\n" +
    noteContent.slice(insertionPoint)
  );
};
