import { describe, expect, test } from "vitest";
import path from "node:path";
import os from "node:os";
import {
  assertAppReachable,
  cliError,
  cliSocketPath,
  parseOutput,
} from "./obsidian";

const UNREACHABLE = /^Obsidian CLI could not reach vault "e2e-vault"\./;

describe("Obsidian not running", () => {
  test("cliError maps the CLI's own connection failure", () => {
    const err = Object.assign(new Error("Command failed"), {
      code: 1,
      stdout: "Unable to connect to main process\n",
    });
    expect(cliError(err, ["vault"]).message).toMatch(UNREACHABLE);
  });

  test("cliError maps a timed-out call", () => {
    const err = Object.assign(new Error("Command failed"), {
      killed: true,
      signal: "SIGTERM",
    });
    expect(cliError(err, ["vault"]).message).toMatch(UNREACHABLE);
  });

  test("cliError does not mistake other connection errors", () => {
    const err = Object.assign(new Error("Command failed"), {
      code: 1,
      stdout: "Unable to connect to sync server.\n",
    });
    expect(cliError(err, ["sync"]).message).not.toMatch(UNREACHABLE);
  });

  test("cliError maps an unknown vault with a non-zero exit", () => {
    const err = Object.assign(new Error("Command failed"), {
      code: 1,
      stdout: "Vault not found.\n",
    });
    expect(cliError(err, ["vault"]).message).toMatch(UNREACHABLE);
  });

  test("cliSocketPath follows XDG_RUNTIME_DIR", () => {
    expect(cliSocketPath({ XDG_RUNTIME_DIR: "/run/user/7" })).toBe(
      "/run/user/7/.obsidian-cli.sock"
    );
    expect(cliSocketPath({})).toBe(
      path.join(os.homedir(), ".obsidian-cli.sock")
    );
  });

  test("assertAppReachable fails fast without the app's socket", async () => {
    await expect(
      assertAppReachable("/nonexistent/.obsidian-cli.sock")
    ).rejects.toThrow(UNREACHABLE);
  });
});

describe("parseOutput with console output", () => {
  test("parseOutput skips console lines printed during eval", () => {
    expect(parseOutput("[warn] e2e warn\n[error] e2e err {}\n=> true\n")).toBe(
      "true"
    );
  });

  test("parseOutput throws an eval error after console lines", () => {
    expect(() => parseOutput("[log] working\nError: boom\n    at x")).toThrow(
      /^Error: boom/
    );
  });
});

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
