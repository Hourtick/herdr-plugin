// Connects the agent CLIs on this machine to Hourtick's MCP server, each with its own documented command.
// Sign-in happens in the browser (OAuth), so no token is ever typed or stored by this plugin.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AGENTS, HOME, MCP_URL, SETTINGS, SIGNUP_URL, ask, bold, dim, green, heading, pause, readJson, red, run,
  runInteractive, which, writeJson, yellow,
} from "./lib.mjs";

const NAME = "hourtick";
/** Each CLI by its full path, since it may not be on herdr's PATH. */
const bin = (id) => which(AGENTS.find((a) => a.id === id).bin);

/** Adds { [NAME]: entry } under `key` in a JSON config file, keeping a backup. Refuses files it can't parse. */
function addToJsonConfig(path, key, entry) {
  let config = {};
  if (existsSync(path)) {
    config = readJson(path, undefined);
    if (config === undefined) return { ok: false, why: `${path} isn't plain JSON (comments?); add it by hand` };
    copyFileSync(path, `${path}.bak-hourtick`);
  } else {
    mkdirSync(dirname(path), { recursive: true });
  }
  config[key] = { ...(config[key] || {}), [NAME]: entry };
  writeJson(path, config);
  return { ok: true };
}

const OPENCODE = join(HOME, ".config", "opencode", "opencode.json");
const CURSOR = join(HOME, ".cursor", "mcp.json");

const METHODS = {
  claude: {
    connected: () => run(bin("claude"), ["mcp", "get", NAME]).ok,
    connect() {
      const r = run(bin("claude"), ["mcp", "add", "--scope", "user", "--transport", "http", NAME, MCP_URL]);
      if (!r.ok && !/already exists/i.test(r.err + r.out)) return { ok: false, why: r.err || r.out };
      console.log(dim("  Signing in (a browser opens)..."));
      if (!runInteractive(bin("claude"), ["mcp", "login", NAME])) return { ok: true, next: "In Claude Code, run /mcp and choose hourtick → Authenticate." };
      return { ok: true };
    },
  },
  codex: {
    connected: () => run(bin("codex"), ["mcp", "get", NAME]).ok,
    connect() {
      console.log(dim("  Codex adds the server and opens the browser to sign in..."));
      return runInteractive(bin("codex"), ["mcp", "add", NAME, "--url", MCP_URL])
        ? { ok: true }
        : { ok: false, why: "codex mcp add failed", next: `Run: codex mcp login ${NAME}` };
    },
  },
  gemini: {
    connected: () => new RegExp(`\\b${NAME}\\b`).test(run(bin("gemini"), ["mcp", "list"]).out),
    connect() {
      const r = run(bin("gemini"), ["mcp", "add", "--scope", "user", "--transport", "http", NAME, MCP_URL]);
      if (!r.ok) return { ok: false, why: r.err || r.out };
      return { ok: true, next: `In Gemini CLI, run /mcp auth ${NAME} to sign in.` };
    },
  },
  opencode: {
    connected: () => Boolean(readJson(OPENCODE, {})?.mcp?.[NAME]),
    connect() {
      const r = addToJsonConfig(OPENCODE, "mcp", { type: "remote", url: MCP_URL, enabled: true });
      if (!r.ok) return r;
      console.log(dim("  Signing in (a browser opens)..."));
      return runInteractive(bin("opencode"), ["mcp", "auth", NAME])
        ? { ok: true }
        : { ok: true, next: `Run: opencode mcp auth ${NAME}` };
    },
  },
  grok: {
    connected: () => new RegExp(`\\b${NAME}\\b`).test(run(bin("grok"), ["mcp", "list"]).out),
    connect() {
      const r = run(bin("grok"), ["mcp", "add", "--transport", "http", NAME, MCP_URL]);
      if (!r.ok) return { ok: false, why: r.err || r.out };
      return { ok: true, next: `Check it with: grok mcp doctor ${NAME}` };
    },
  },
  droid: {
    connected: () => new RegExp(`\\b${NAME}\\b`).test(run(bin("droid"), ["mcp", "list"]).out),
    connect() {
      return runInteractive(bin("droid"), ["mcp", "add", NAME, MCP_URL, "--type", "http"])
        ? { ok: true }
        : { ok: false, why: "droid mcp add failed" };
    },
  },
  cursor: {
    connected: () => Boolean(readJson(CURSOR, {})?.mcpServers?.[NAME]),
    connect() {
      const r = addToJsonConfig(CURSOR, "mcpServers", { url: MCP_URL });
      return r.ok ? { ok: true, next: "In Cursor, open Settings → MCP and click Connect next to hourtick." } : r;
    },
  },
};

heading("connect your agents");
console.log(`Your agents get Hourtick's tools: tasks, comments, team chat and time tracking,`);
console.log(`working as you (or as an AI agent of your team). No Hourtick account yet? ${bold(SIGNUP_URL)}\n`);

const found = AGENTS.filter((a) => which(a.bin));
if (!found.length) {
  console.log(yellow("No supported agent CLI found on PATH (Claude Code, Codex, Gemini CLI, opencode, Grok, Droid, Cursor CLI)."));
  console.log(`Install one, or add ${MCP_URL} as a remote MCP server in your agent by hand.`);
  await pause();
  process.exit(0);
}

const status = found.map((a) => ({ ...a, connected: METHODS[a.id].connected() }));
status.forEach((a, i) => console.log(`  ${i + 1}. ${a.name.padEnd(14)} ${a.connected ? green("connected") : dim("not connected")}`));

const todo = status.filter((a) => !a.connected);
if (!todo.length) {
  console.log(green("\nAll your agents are connected. Use “Hourtick: start an agent on a task” next."));
  writeJson(SETTINGS, { ...readJson(SETTINGS, {}), connected: status.map((a) => a.id) });
  await pause();
  process.exit(0);
}

const answer = (await ask(`\nConnect ${todo.map((a) => a.name).join(", ")}? [Y/n, or numbers like 1 3] `)).toLowerCase();
let chosen = todo;
if (answer === "n" || answer === "no") chosen = [];
else if (/\d/.test(answer)) chosen = answer.split(/[\s,]+/).map((n) => status[Number(n) - 1]).filter((a) => a && !a.connected);

const notes = [];
for (const a of chosen) {
  console.log(`\n${bold(a.name)}`);
  let r;
  try {
    r = METHODS[a.id].connect();
  } catch (e) {
    r = { ok: false, why: e.message };
  }
  if (r.ok && !r.next) console.log(green("  connected"));
  else if (r.ok) console.log(yellow("  added: sign in next (see below)"));
  else console.log(red(`  not connected: ${r.why}`));
  if (r.ok) a.connected = true;
  if (r.next) notes.push(`${a.name}: ${r.next}`);
}

writeJson(SETTINGS, { ...readJson(SETTINGS, {}), connected: status.filter((a) => a.connected).map((a) => a.id) });
if (notes.length) {
  console.log(`\n${bold("One more step")}`);
  notes.forEach((n) => console.log(`  ${n}`));
}
console.log(`\nNext: ${bold("Hourtick: start an agent on a task")}, or ask your agent “What's on my plate today?”`);
await pause();
