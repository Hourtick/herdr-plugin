// Starts an agent in a new tab, in the same folder, on a Hourtick task. The agent reads and updates the task itself
// over its own Hourtick connection (set up with "connect"), so this plugin never holds a Hourtick credential.
import { AGENTS, SETTINGS, ask, bold, dim, green, heading, originPane, pause, readJson, red, startAgentInNewTab, which, writeJson, yellow } from "./lib.mjs";

const prompt = (n) =>
  [
    `Work on Hourtick task #${n} using the hourtick MCP tools.`,
    `1. Call whoami if you haven't yet, then get_task ${n} to read the description, checklist, comments and files (open screenshots with read_attachment).`,
    `2. Move it to in_progress with update_task, and say what you'll do in a comment_on_task.`,
    `3. Do the work in this folder. If something is unclear, ask in a comment and stop.`,
    `4. When you're done: comment_on_task with what you changed, how you checked it and what's left for a person; log your time with log_time on the task; and move it to review with update_task.`,
    `Reply to me here with a short summary.`,
  ].join("\n");

heading("start an agent on a task");

let number = (process.env.HOURTICK_TASK_URL || "").match(/[?&]task=(\d+)/)?.[1];
if (number) console.log(`Task ${bold("#" + number)} ${dim(process.env.HOURTICK_TASK_URL)}`);
while (!number) {
  const a = await ask("Task number or link (#12 or https://hourtick.com/app/tasks?task=12): ");
  if (!a) process.exit(0);
  number = a.match(/[?&]task=(\d+)/)?.[1] || a.match(/^#?(\d+)$/)?.[1];
  if (!number) console.log(red("That isn't a task number or a Hourtick task link."));
}

const settings = readJson(SETTINGS, {});
const installed = AGENTS.filter((a) => which(a.bin));
const connected = installed.filter((a) => (settings.connected || []).includes(a.id));
const choices = connected.length ? connected : installed;
if (!choices.length) {
  console.log(yellow("No agent CLI found. Install one and run “Hourtick: connect your agents” first."));
  await pause();
  process.exit(0);
}
if (!connected.length) console.log(yellow("None of your agents is connected to Hourtick yet: run “Hourtick: connect your agents” first, or the agent can't read the task."));

let agent = choices.find((a) => a.id === settings.lastAgent) || choices[0];
if (choices.length > 1) {
  choices.forEach((a, i) => console.log(`  ${i + 1}. ${a.name}${a.id === agent.id ? dim("  (default)") : ""}`));
  const pick = await ask(`Agent [${choices.indexOf(agent) + 1}]: `);
  if (pick) agent = choices[Number(pick) - 1] || agent;
}
writeJson(SETTINGS, { ...settings, lastAgent: agent.id });

const origin = originPane();
const cwd = origin?.foreground_cwd || origin?.cwd || process.cwd();
const workspace = origin?.workspace_id || process.env.HERDR_WORKSPACE_ID;

try {
  const r = await startAgentInNewTab({ kind: agent.kind, cwd, workspace, label: `#${number}`, baseName: `task-${number}`, text: prompt(number) });
  if (r.waiting) {
    console.log(yellow(`\n${agent.name} is asking you something first in tab “#${number}” (for example to trust this folder).`));
    console.log("Answer it there; the task follows by itself.");
    await pause();
  } else {
    console.log(green(`\n${agent.name} is working on #${number} in tab “#${number}” (${r.name}).`));
  }
} catch (e) {
  console.log(red(`\nCouldn't start the agent: ${e.message}`));
  await pause();
}
