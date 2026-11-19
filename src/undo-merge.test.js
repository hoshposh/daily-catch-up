import { describe, expect, test } from "vitest";
import { addedLineCount, restoreKeepingNewLines } from "./undo-merge";

const cases = [
  {
    name: "a capture after the deleted todos",
    before: "## Captured\n- [ ] a\n- [ ] b\n",
    after: "## Captured\n",
    current: "## Captured\n- [ ] c\n",
    expected: "## Captured\n- [ ] a\n- [ ] b\n- [ ] c\n",
    added: 1,
  },
  {
    name: "a capture at the end of a longer note",
    before: "## Captured\n- [ ] a\n\n## Later\n- [ ] x\n",
    after: "## Captured\n\n## Later\n- [ ] x\n",
    current: "## Captured\n\n## Later\n- [ ] x\n- [ ] c\n",
    expected: "## Captured\n- [ ] a\n\n## Later\n- [ ] x\n- [ ] c\n",
    added: 1,
  },
  {
    name: "undo after mark",
    before: "- [ ] a\n",
    after: "- [>] a\n",
    current: "- [>] a\n- [ ] c\n",
    expected: "- [ ] a\n- [ ] c\n",
    added: 1,
  },
  {
    name: "a capture into an emptied note",
    before: "- [ ] a\n",
    after: "",
    current: "- [ ] c\n",
    expected: "- [ ] a\n- [ ] c\n",
    added: 1,
  },
  {
    name: "an edited line comes back next to the original",
    before: "## C\n- [ ] a\n- [ ] keep\n",
    after: "## C\n- [ ] keep\n",
    current: "## C\n- [ ] keep (edited)\n- [ ] c\n",
    expected: "## C\n- [ ] a\n- [ ] keep\n- [ ] keep (edited)\n- [ ] c\n",
    added: 2,
  },
  {
    name: "two separate runs",
    before: "## A\n- [ ] a\n## B\n- [ ] b\n",
    after: "## A\n## B\n",
    current: "## A\n- [ ] x\n## B\n- [ ] y\n",
    expected: "## A\n- [ ] a\n- [ ] x\n## B\n- [ ] b\n- [ ] y\n",
    added: 2,
  },
  {
    name: "no newline at the end",
    before: "- [ ] a",
    after: "",
    current: "- [ ] c",
    expected: "- [ ] a\n- [ ] c",
    added: 1,
  },
];

describe("restoreKeepingNewLines", () => {
  test("nothing added: the snapshot", () => {
    const before = "## Captured\n- [ ] a\n- [ ] b\n";
    const after = "## Captured\n";
    expect(restoreKeepingNewLines({ before, after, current: after })).toBe(
      before
    );
    expect(addedLineCount({ after, current: after })).toBe(0);
  });

  test.each(cases)("$name", ({ before, after, current, expected, added }) => {
    expect(restoreKeepingNewLines({ before, after, current })).toBe(expected);
    expect(addedLineCount({ after, current })).toBe(added);
  });

  test("lines dropped since the rollover come back with the snapshot", () => {
    expect(
      restoreKeepingNewLines({
        before: "- [ ] a\n- [ ] b\n",
        after: "- [ ] b\n",
        current: "",
      })
    ).toBe("- [ ] a\n- [ ] b\n");
  });

  test("a carriage return stays part of its line", () => {
    expect(
      restoreKeepingNewLines({
        before: "- [ ] a\r\n",
        after: "",
        current: "- [ ] c\r\n",
      })
    ).toBe("- [ ] a\r\n- [ ] c\r\n");
  });
});
