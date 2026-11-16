// Drives the running Obsidian app through the official `obsidian` CLI.
// Every call targets VAULT_NAME; arguments go through execFile as an array,
// never a shell string.
import { execFile } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const VAULT_NAME = process.env.E2E_VAULT ?? "e2e-vault";
export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const SCREENSHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots");
export const SCREENSHOT_INDEX = path.join(SCREENSHOT_DIR, ".index");

const UNREACHABLE = () =>
  `Obsidian CLI could not reach vault "${VAULT_NAME}". Open it in Obsidian and keep Obsidian running.`;

/** The CLI's printed result: `=> ` prefix removed, errors thrown. */
export function parseOutput(stdout) {
  const text = (stdout ?? "").trim();
  if (text.startsWith("Error:")) throw new Error(text);
  if (text === "Vault not found.") throw new Error(`${UNREACHABLE()}\n${text}`);
  if (text === "(no output)") return "";
  return text.startsWith("=> ") ? text.slice(3) : text;
}

/** A readable error for a CLI process that failed to run or exited non-zero. */
export function cliError(err, args) {
  const output = [err?.stdout, err?.stderr].filter(Boolean).join("\n").trim();
  if (
    err?.code === "ENOENT" ||
    /not running|ECONNREFUSED|connect/i.test(output)
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

export async function capturedErrors() {
  const out = await obsidian(["dev:errors"]);
  if (out === "" || out === "No errors captured.") return [];
  return [out];
}

export async function clearErrors() {
  await obsidian(["dev:errors", "clear"]);
}

export async function screenshot(name) {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await obsidian(["dev:screenshot", `path=${file}`]);
  await appendFile(SCREENSHOT_INDEX, `${file}\n`);
  return file;
}

export async function setMobile(on) {
  if ((await evalJson("app.isMobile")) === on) return;
  await obsidian(["dev:mobile", on ? "on" : "off"]);
  await waitFor(async () => (await evalJson("app.isMobile")) === on, {
    message: `mobile emulation ${on ? "on" : "off"}`,
  });
}
