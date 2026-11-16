import { describe, expect, test } from "vitest";
import { cliError, parseOutput } from "./obsidian";

describe("parseOutput", () => {
  test("parseOutput strips the result prefix", () => {
    expect(parseOutput("=> 42\n")).toBe("42");
    expect(parseOutput('=> ["a"]')).toBe('["a"]');
    expect(parseOutput("")).toBe("");
  });

  test("parseOutput treats (no output) as empty", () => {
    expect(parseOutput("(no output)\n")).toBe("");
  });

  test("parseOutput keeps plain command output", () => {
    expect(parseOutput("name\te2e-vault\npath\t/x\n")).toBe(
      "name\te2e-vault\npath\t/x"
    );
  });

  test("parseOutput throws on an eval error", () => {
    expect(() => parseOutput("Error: boom\n    at x")).toThrow(/Error: boom/);
    expect(() => parseOutput("Error: boom\n    at x")).toThrow(/at x/);
  });

  test("parseOutput throws when the vault is unknown", () => {
    expect(() => parseOutput("Vault not found.\n")).toThrow(
      /^Obsidian CLI could not reach vault "e2e-vault"\./
    );
  });
});

describe("cliError", () => {
  test("cliError explains an unreachable app", () => {
    const err = Object.assign(new Error("spawn obsidian ENOENT"), {
      code: "ENOENT",
    });
    expect(cliError(err, ["vault"]).message).toMatch(
      /^Obsidian CLI could not reach vault "e2e-vault"\. Open it in Obsidian and keep Obsidian running\./
    );
  });

  test("cliError names the command for other failures", () => {
    const err = Object.assign(new Error("Command failed"), {
      code: 2,
      stdout: "something odd",
    });
    const message = cliError(err, ["command", "id=x"]).message;
    expect(message).toContain("command id=x");
    expect(message).toContain("something odd");
  });
});
