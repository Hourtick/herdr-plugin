// Shows the agent time measured on this machine, grouped by day and folder, and hands it to an agent to log in
// Hourtick (log_time over its own connection). Nothing leaves this machine until you choose to log it.
import { basename, join } from "node:path";
import { AGENTS, SETTINGS, STATE_DIR, ask, bold, dim, green, heading, originPane, pause, readJson, startAgentInNewTab, which, withLock, writeJson, yellow } from "./lib.mjs";

const LEDGER = join(STATE_DIR, "ledger.json");
const fmt = (s) => {
  const m = Math.max(1, Math.round(s / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};
const day = (ms) => new Date(ms).toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

heading("agent time");
const ledger = readJson(LEDGER, { open: {}, entries: [] });
const open = Object.values(ledger.open);
if (open.length) console.log(dim(`Running now: ${open.map((o) => `${o.name || o.agent} in ${basename(o.cwd) || "?"} (${fmt((Date.now() - o.since) / 1000)})`).join(", ")}\n`));

const todo = ledger.entries.filter((e) => !e.logged);
if (!todo.length) {
  console.log("No unlogged agent time yet. It's measured from when an agent starts working until it stops.");
  await pause();
  process.exit(0);
}

const groups = new Map();
for (const e of todo) {
  const key = `${day(e.start)}\t${e.cwd}`;
  const g = groups.get(key) || { day: day(e.start), cwd: e.cwd, workspace: e.workspace, seconds: 0, agents: new Set(), count: 0 };
  g.seconds += e.seconds;
  g.agents.add(e.name || e.agent);
  g.count += 1;
  groups.set(key, g);
}
const rows = [...groups.values()].sort((a, b) => a.day.localeCompare(b.day) || a.cwd.localeCompare(b.cwd));
for (const g of rows) {
  console.log(`  ${g.day}  ${fmt(g.seconds).padStart(7)}  ${bold(basename(g.cwd) || g.cwd)}  ${dim(`${g.cwd} · ${[...g.agents].join(", ")} · ${g.count} stretch${g.count > 1 ? "es" : ""}`)}`);
}
console.log(dim(`\nTotal ${fmt(rows.reduce((t, g) => t + g.seconds, 0))} unlogged.`));

const choice = (await ask(`\n[L] log in Hourtick with an agent · [C] clear without logging · Enter to close: `)).toLowerCase();

if (choice === "c") {
  await withLock("ledger", async () => {
    const l = readJson(LEDGER, { open: {}, entries: [] });
    l.entries.forEach((e) => (e.logged = e.logged || "cleared"));
    writeJson(LEDGER, l);
  });
  console.log("Cleared.");
} else if (choice === "l") {
  const settings = readJson(SETTINGS, {});
  const agent =
    AGENTS.find((a) => a.id === settings.lastAgent && which(a.bin)) ||
    AGENTS.find((a) => (settings.connected || []).includes(a.id) && which(a.bin)) ||
    AGENTS.find((a) => which(a.bin));
  if (!agent) {
    console.log(yellow("No agent CLI found to log with. Run “Hourtick: connect your agents” first."));
    await pause();
    process.exit(0);
  }
  const lines = rows.map((g) => `- ${g.day}: ${fmt(g.seconds)} of AI agent work in ${g.cwd} (folder "${basename(g.cwd)}"${g.workspace ? `, herdr workspace "${g.workspace}"` : ""}) by ${[...g.agents].join(", ")}`);
  const message = [
    "Log this AI agent work time to Hourtick with log_time, one entry per line, on the line's date:",
    ...lines,
    "Find each line's project with list_projects (the folder and workspace names are hints) and use the task type for development work. If you can't tell which project a line belongs to, ask me instead of guessing.",
    "Put \"AI agent work (herdr)\" and the folder in the notes. Reply with what you logged.",
  ].join("\n");
  const origin = originPane();
  try {
    const r = await startAgentInNewTab({
      kind: agent.kind, cwd: origin?.cwd || process.cwd(), workspace: origin?.workspace_id, label: "log time", baseName: "log-time", text: message,
    });
    const ids = new Set(todo.map((e) => e.start + e.cwd));
    await withLock("ledger", async () => {
      const l = readJson(LEDGER, { open: {}, entries: [] });
      l.entries.forEach((e) => {
        if (ids.has(e.start + e.cwd)) e.logged = new Date().toISOString();
      });
      writeJson(LEDGER, l);
    });
    console.log(green(r.waiting
      ? `${agent.name} is asking you something first in the “log time” tab; answer it there and it logs the time.`
      : `${agent.name} is logging it in the “log time” tab. Check its reply there.`));
    if (r.waiting) await pause();
  } catch (e) {
    console.log(yellow(`Couldn't start an agent: ${e.message}`));
    await pause();
  }
}
