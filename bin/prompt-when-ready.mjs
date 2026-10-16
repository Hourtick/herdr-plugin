// Detached helper: waits until an agent that stopped at a startup question (trust this folder, sign in ...) is ready,
// then sends it its prompt. Gives up after 15 minutes.
import { readFileSync, rmSync } from "node:fs";
import { herdr } from "./lib.mjs";

const [name, file] = process.argv.slice(2);
const text = readFileSync(file, "utf8");
rmSync(file, { force: true });
try {
  herdr("agent", "wait", name, "--until", "idle", "--until", "done", "--timeout", "900000");
  herdr("agent", "prompt", name, text);
} catch {
  // The agent was closed or never became ready; nothing to do.
}
