// Runs for an action: opens the matching pane and passes on where it was opened from (and a clicked task link).
import { herdr, PLUGIN_ID } from "./lib.mjs";

const entrypoint = process.argv[2];
let context = {};
try {
  context = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}");
} catch {}

const pane = process.env.HERDR_PANE_ID || context.focused_pane_id || context.pane_id || "";
const url = process.env.HERDR_PLUGIN_CLICKED_URL || context.clicked_url || "";

// Overlay panes always open over the active pane, so no workspace or target is passed.
const args = ["plugin", "pane", "open", "--plugin", PLUGIN_ID, "--entrypoint", entrypoint, "--focus"];
if (pane) args.push("--env", `HOURTICK_ORIGIN_PANE=${pane}`);
if (url) args.push("--env", `HOURTICK_TASK_URL=${url}`);

try {
  herdr(...args);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
