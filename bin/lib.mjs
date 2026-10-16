// Shared helpers. No dependencies: Node 18+ only.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

export const MCP_URL = "https://hourtick.com/api/mcp";
export const SIGNUP_URL = "https://hourtick.com/sign-up?utm_source=herdr&utm_medium=plugin";
export const HOME = homedir();

export const PLUGIN_ID = process.env.HERDR_PLUGIN_ID || "hourtick";
export const STATE_DIR = process.env.HERDR_PLUGIN_STATE_DIR || join(HOME, ".hourtick-herdr");
mkdirSync(STATE_DIR, { recursive: true });

const color = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const bold = color("1");
export const dim = color("2");
export const green = color("32");
export const yellow = color("33");
export const red = color("31");

/** Runs a command without a shell. Returns { ok, code, out, err }. */
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: false, ...opts });
  return { ok: r.status === 0, code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || r.error?.message || "").trim() };
}

/** Runs a command attached to this terminal (for sign-in flows that open a browser). */
export function runInteractive(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false });
  return r.status === 0;
}

// herdr's server may run with a shorter PATH than your shell, so the usual install folders are searched too.
const EXTRA_DIRS = [
  join(HOME, ".local", "bin"), join(HOME, ".claude", "local"), join(HOME, ".bun", "bin"), join(HOME, ".npm-global", "bin"),
  join(HOME, ".volta", "bin"), join(HOME, ".opencode", "bin"), join(HOME, ".factory", "bin"), "/opt/homebrew/bin", "/usr/local/bin",
];

/** The full path of an executable on PATH (or in a usual install folder), or null. */
export function which(bin) {
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of [...(process.env.PATH || "").split(delimiter), ...EXTRA_DIRS]) {
    for (const ext of exts) {
      const p = join(dir, bin + ext);
      if (dir && existsSync(p)) return p;
    }
  }
  return null;
}

/** Calls the herdr CLI and returns its parsed JSON result. */
export function herdr(...args) {
  const bin = process.env.HERDR_BIN_PATH || "herdr";
  const r = run(bin, args);
  if (!r.ok) throw new Error(`herdr ${args.slice(0, 2).join(" ")}: ${r.err || r.out}`);
  try {
    return r.out ? JSON.parse(r.out).result : {};
  } catch {
    return {};
  }
}

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(path, value) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, path);
}

/** A tiny cross-process lock (mkdir is atomic), so concurrent event hooks don't lose updates. */
export async function withLock(name, fn) {
  const dir = join(STATE_DIR, `${name}.lock`);
  for (let i = 0; i < 100; i++) {
    try {
      mkdirSync(dir);
      try {
        return await fn();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  rmSync(dir, { recursive: true, force: true }); // a crashed holder left it behind
  return fn();
}

export async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function pause(message = "Press Enter to close.") {
  await ask(dim(`\n${message} `));
}

export function heading(text) {
  console.log(`\n${bold("Hourtick")} ${dim("·")} ${text}\n`);
}

/** The pane this was opened from (passed by open.mjs), else the focused one. */
export function originPane() {
  const id = process.env.HOURTICK_ORIGIN_PANE || process.env.HERDR_PANE_ID;
  if (!id) return null;
  try {
    return herdr("pane", "get", id).pane;
  } catch {
    return null;
  }
}

/** Agent CLIs this plugin can connect, with how herdr starts them. */
export const AGENTS = [
  { id: "claude", name: "Claude Code", bin: "claude", kind: "claude" },
  { id: "codex", name: "Codex", bin: "codex", kind: "codex" },
  { id: "gemini", name: "Gemini CLI", bin: "gemini", kind: "gemini" },
  { id: "opencode", name: "opencode", bin: "opencode", kind: "opencode" },
  { id: "grok", name: "Grok Build", bin: "grok", kind: "grok" },
  { id: "droid", name: "Factory Droid", bin: "droid", kind: "droid" },
  { id: "cursor", name: "Cursor CLI", bin: "cursor-agent", kind: "cursor" },
];

export const SETTINGS = join(STATE_DIR, "settings.json");

/**
 * Starts an agent of `kind` in a new tab and gives it `text`. If the agent stops at a startup question (trust this
 * folder, sign in ...), the person answers it in that tab and the prompt follows by itself.
 * Returns { name, waiting } where waiting means it's waiting for the person first.
 */
export async function startAgentInNewTab({ kind, cwd, workspace, label, baseName, text }) {
  const tab = herdr("tab", "create", ...(workspace ? ["--workspace", workspace] : []), "--cwd", cwd, "--label", label, "--focus");
  const pane = tab.root_pane.pane_id;
  const names = new Set((herdr("agent", "list").agents || []).map((a) => a.name).filter(Boolean));
  let name = baseName;
  for (let i = 2; names.has(name); i++) name = `${baseName}-${i}`;
  for (let i = 0; ; i++) {
    try {
      herdr("agent", "start", name, "--kind", kind, "--pane", pane, "--timeout", "60000");
      break;
    } catch (e) {
      if (/agent_not_ready/.test(e.message)) {
        const file = join(STATE_DIR, `prompt-${name}-${Date.now()}.txt`);
        writeFileSync(file, text);
        spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "prompt-when-ready.mjs"), name, file], {
          detached: true, stdio: "ignore", env: process.env,
        }).unref();
        return { name, waiting: true };
      }
      if (!/agent_pane_busy|not an available shell/.test(e.message) || i >= 10) throw e;
      await new Promise((r) => setTimeout(r, 500)); // the new shell isn't at its prompt yet
    }
  }
  herdr("agent", "prompt", name, text);
  return { name, waiting: false };
}
