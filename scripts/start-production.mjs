import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

function loadDotEnv() {
  const envPath = resolve(repoRoot, ".env");
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function spawnNode(label, script, extraEnv = {}) {
  const child = spawn(process.execPath, [script], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    windowsHide: false,
  });
  child.once("error", (err) => {
    process.stderr.write(`[${label}] failed to start: ${err.stack ?? err}\n`);
  });
  return child;
}

loadDotEnv();

const children = new Set();
let shuttingDown = false;

// The Discord bridge bot is spawned/managed by the server itself
// (see packages/server/src/services/discord-bridge/bot-process.service.ts),
// not by this launcher, so there's exactly one owner of that child process.
const server = spawnNode("server", "packages/server/dist/index.js");
children.add(server);

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

server.once("exit", (code, signal) => {
  children.delete(server);
  shutdown("SIGTERM");
  process.exit(code ?? (signal ? 1 : 0));
});
