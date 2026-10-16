// pane.agent_status_changed: records how long each agent works, locally in the plugin's state folder.
// A stretch starts when an agent turns "working" and ends at anything else (done, idle, blocked on you, closed).
import { join } from "node:path";
import { STATE_DIR, herdr, readJson, withLock, writeJson } from "./lib.mjs";

const LEDGER = join(STATE_DIR, "ledger.json");
const MIN_SECONDS = 30;

let event = {};
try {
  event = JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON || "{}");
} catch {}
// The last event as received, to help debug a herdr version that names things differently.
writeJson(join(STATE_DIR, "last-event.json"), event);
const data = event.data || event;
const paneId = data.pane_id || data.pane?.pane_id;
const status = String(data.agent_status || data.status || "").toLowerCase();
if (!paneId || !status) process.exit(0);

let pane = null;
try {
  pane = herdr("pane", "get", paneId).pane;
} catch {}

await withLock("ledger", async () => {
  const ledger = readJson(LEDGER, { open: {}, entries: [] });
  const now = Date.now();
  const open = ledger.open[paneId];
  if (status === "working") {
    if (!open) {
      let workspace = "";
      try {
        workspace = herdr("workspace", "get", pane?.workspace_id || "").workspace?.label || "";
      } catch {}
      ledger.open[paneId] = {
        since: now,
        agent: data.agent || pane?.agent || "agent",
        name: pane?.name || data.name || "",
        cwd: pane?.foreground_cwd || pane?.cwd || "",
        workspace,
      };
    }
  } else if (open) {
    delete ledger.open[paneId];
    const seconds = Math.round((now - open.since) / 1000);
    if (seconds >= MIN_SECONDS) ledger.entries.push({ ...open, start: open.since, end: now, seconds, logged: false });
  }
  // Keep the file small: drop logged entries older than 60 days.
  const cutoff = now - 60 * 86400_000;
  ledger.entries = ledger.entries.filter((e) => !e.logged || e.end > cutoff);
  writeJson(LEDGER, ledger);
});
