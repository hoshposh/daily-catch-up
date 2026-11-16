// Drives the running Obsidian app through the official `obsidian` CLI.
// Every call targets VAULT_NAME; arguments go through execFile as an array,
// never a shell string.
import { execFile } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const VAULT_NAME = process.env.E2E_VAULT ?? "e2e-vault";
export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const SCREENSHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots");
export const SCREENSHOT_INDEX = path.join(SCREENSHOT_DIR, ".index");

const UNREACHABLE = () =>
  `Obsidian CLI could not reach vault "${VAULT_NAME}". Open it in Obsidian and keep Obsidian running.`;

const CONSOLE_LINE = /^\[(log|info|warn|error|debug)\] /;

/** The CLI's printed result: `=> ` prefix removed, errors thrown. */
export function parseOutput(stdout) {
  // console output printed while `eval` ran comes first, one `[level] ` line
  // per message
  const lines = (stdout ?? "").trim().split("\n");
  while (lines.length > 1 && CONSOLE_LINE.test(lines[0])) lines.shift();
  const text = lines.join("\n").trim();
  if (text.startsWith("Error:")) throw new Error(text);
  if (text === "Vault not found.") throw new Error(`${UNREACHABLE()}\n${text}`);
  if (text === "(no output)") return "";
  return text.startsWith("=> ") ? text.slice(3) : text;
}

/** A readable error for a CLI process that failed to run or exited non-zero. */
export function cliError(err, args) {
  const output = [err?.stdout, err?.stderr].filter(Boolean).join("\n").trim();
  const lines = output.split("\n").map((line) => line.trim());
  if (
    err?.code === "ENOENT" ||
    err?.killed === true ||
    lines.includes("Unable to connect to main process") ||
    lines.includes("Vault not found.")
  ) {
    return new Error(
      `${UNREACHABLE()}\n${err?.message ?? ""}\n${output}`.trim()
    );
  }
  return new Error(
    `obsidian ${args.join(" ")} failed: ${
      err?.message ?? err
    }\n${output}`.trim()
  );
}

/**
 * The socket a running Obsidian listens on for the CLI. Without it, the
 * `obsidian` binary starts the app itself instead of talking to it.
 */
export function cliSocketPath(env = process.env) {
  return path.join(env.XDG_RUNTIME_DIR || os.homedir(), ".obsidian-cli.sock");
}

/** Fails fast, with the usual message, when Obsidian is not running. */
export function assertAppReachable(socketPath = cliSocketPath()) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", (e) => {
      reject(
        new Error(`${UNREACHABLE()}\n${socketPath}: ${e.code ?? e.message}`)
      );
    });
  });
}

export function obsidian(args, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "obsidian",
      [`vault=${VAULT_NAME}`, ...args],
      { timeout, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(cliError(Object.assign(err, { stdout, stderr }), args));
          return;
        }
        try {
          resolve(parseOutput(stdout));
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

export function evalJs(code) {
  return obsidian(["eval", `code=${code}`]);
}

export async function evalJson(expr) {
  const out = await evalJs(`JSON.stringify(${expr})`);
  return out === "" ? null : JSON.parse(out);
}

export async function command(id) {
  await obsidian(["command", `id=${id}`]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls fn until it returns something truthy; fails with the last value seen. */
export async function waitFor(
  fn,
  { timeout = 10000, interval = 100, message = "condition" } = {}
) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = String(e?.message ?? e);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for ${message}; last value: ${JSON.stringify(last)}`
      );
    }
    await sleep(interval);
  }
}

/** Starts an async snippet in the app; its result is read with awaitAsync(). */
export async function startAsync(body) {
  await evalJs(
    `window.__e2e = { done: false }; (async () => { ${body}\n})().then(v => { window.__e2e = { done: true, value: v }; }, e => { window.__e2e = { done: true, error: String(e?.stack ?? e) }; }); true`
  );
}

export async function awaitAsync({ timeout = 30000 } = {}) {
  const state = await waitFor(
    async () => {
      const s = await evalJson("window.__e2e ?? null");
      return s?.done ? s : null;
    },
    { timeout, message: "the async snippet to finish" }
  );
  if (state.error !== undefined) throw new Error(state.error);
  return state.value;
}

/**
 * Uncaught errors (dev:errors) and console.error messages (dev:console; the
 * plugin logs its own failures that way, and dev:errors does not see them)
 * since the last clearErrors().
 */
export async function capturedErrors() {
  const errors = [];
  const uncaught = await obsidian(["dev:errors"]);
  if (uncaught !== "" && uncaught !== "No errors captured.") {
    errors.push(uncaught);
  }
  const logged = await obsidian(["dev:console", "level=error", "limit=200"]);
  if (logged !== "" && logged !== "No console messages captured.") {
    errors.push(logged);
  }
  return errors;
}

export async function clearErrors() {
  await obsidian(["dev:errors", "clear"]);
  await obsidian(["dev:console", "clear"]);
}

export async function screenshot(name) {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await obsidian(["dev:screenshot", `path=${file}`]);
  await appendFile(SCREENSHOT_INDEX, `${file}\n`);
  return file;
}

/**
 * Obsidian's mobile emulation. Switching it reloads the app (closing its
 * dialogs) and keeps the window's width, and the setting survives restarts.
 * On its own it does not give phone width: call setViewportWidth() first,
 * then setMobile(true), and the reload picks the phone layout (the settings
 * test does this, because the settings popout cannot be narrowed below
 * 600 px). reset() and the global teardown switch it off again.
 */
export async function setMobile(on) {
  if ((await evalJson("app.isMobile")) === on) return;
  await obsidian(["dev:mobile", on ? "on" : "off"]);
  await waitFor(async () => (await evalJson("app.isMobile")) === on, {
    message: `mobile emulation ${on ? "on" : "off"}`,
    timeout: 30000,
  });
}

/**
 * Narrows the window's viewport to `width` CSS pixels, like a phone or a
 * narrow window (Chrome DevTools device metrics); null restores it.
 */
export async function setViewportWidth(width) {
  if (width === null) {
    await obsidian(["dev:cdp", "method=Emulation.clearDeviceMetricsOverride"]);
    return;
  }
  const height = await evalJson("innerHeight");
  await obsidian([
    "dev:cdp",
    "method=Emulation.setDeviceMetricsOverride",
    `params=${JSON.stringify({
      width,
      height,
      deviceScaleFactor: 1,
      mobile: true,
    })}`,
  ]);
  await waitFor(async () => (await evalJson("innerWidth")) === width, {
    message: `a ${width}px wide viewport`,
  });
}
