#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

const rootRequire = createRequire(new URL("../package.json", import.meta.url));
const serverRequire = createRequire(new URL("../packages/server/package.json", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const supportedOnnxTuples = new Set(["darwin/arm64", "darwin/x64", "linux/arm64", "linux/x64", "win32/arm64", "win32/x64"]);
const tuple = `${process.platform}/${process.arch}`;

function log(message) {
  console.log(`[native-deps] ${message}`);
}

function warn(message) {
  console.warn(`[native-deps] ${message}`);
}

function resolvePackageDir(packageName) {
  try {
    return dirname(serverRequire.resolve(`${packageName}/package.json`));
  } catch {
    return null;
  }
}

function getOnnxBindingPath(packageDir) {
  return join(packageDir, "bin", "napi-v6", process.platform, process.arch, "onnxruntime_binding.node");
}

function listInstalledOnnxArchs(packageDir) {
  const platformDir = join(packageDir, "bin", "napi-v6", process.platform);
  if (!existsSync(platformDir)) return [];
  try {
    return readdirSync(platformDir)
      .filter((arch) => existsSync(join(platformDir, arch, "onnxruntime_binding.node")))
      .sort();
  } catch {
    return [];
  }
}

function resolvePnpmCommand() {
  const pnpmCliPath = process.env.npm_execpath;
  const npmUserAgent = process.env.npm_config_user_agent ?? "";
  const useCurrentPnpm =
    Boolean(pnpmCliPath) && (npmUserAgent.startsWith("pnpm/") || basename(pnpmCliPath ?? "").startsWith("pnpm"));

  if (useCurrentPnpm && pnpmCliPath) {
    return { command: process.execPath, args: [pnpmCliPath] };
  }

  try {
    const pkg = rootRequire("./package.json");
    const pnpmVersion = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[1] : null;
    if (pnpmVersion) {
      return { command: "corepack", args: [`pnpm@${pnpmVersion}`] };
    }
  } catch {
    // Fall through to pnpm on PATH.
  }

  return { command: "pnpm", args: [] };
}

function rebuildOnnxRuntime() {
  if (process.env.MARINARA_NATIVE_DEPS_REPAIRING === "1") {
    warn("Skipping nested onnxruntime-node rebuild.");
    return false;
  }

  const runner = resolvePnpmCommand();
  const args = [
    ...runner.args,
    "--config.trustPolicy=off",
    "--config.confirmModulesPurge=false",
    "rebuild",
    "onnxruntime-node",
  ];

  log(`Rebuilding onnxruntime-node for ${tuple}...`);
  const result = spawnSync(runner.command, args, {
    cwd: repoRoot,
    env: { ...process.env, MARINARA_NATIVE_DEPS_REPAIRING: "1" },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status === 0) return true;
  warn(`onnxruntime-node rebuild exited with ${result.signal ?? result.status ?? "unknown status"}.`);
  return false;
}

function forceInstallNativeDeps() {
  if (process.env.MARINARA_NATIVE_DEPS_REPAIRING === "1") {
    warn("Skipping nested forced install repair.");
    return false;
  }

  const runner = resolvePnpmCommand();
  const args = [
    ...runner.args,
    "--config.trustPolicy=off",
    "--config.confirmModulesPurge=false",
    "install",
    "--force",
    "--frozen-lockfile",
  ];

  log(`Refreshing native dependencies for ${tuple}...`);
  const result = spawnSync(runner.command, args, {
    cwd: repoRoot,
    env: { ...process.env, MARINARA_NATIVE_DEPS_REPAIRING: "1" },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status === 0) return true;
  warn(`Forced dependency refresh exited with ${result.signal ?? result.status ?? "unknown status"}.`);
  return false;
}

function ensureOnnxRuntime() {
  if (!supportedOnnxTuples.has(tuple)) {
    log(`Skipping onnxruntime-node check for unsupported runtime ${tuple}.`);
    return;
  }

  const packageDir = resolvePackageDir("onnxruntime-node");
  if (!packageDir) {
    warn("onnxruntime-node is not installed. Local Whisper will stay unavailable until dependencies are installed.");
    return;
  }

  const bindingPath = getOnnxBindingPath(packageDir);
  if (existsSync(bindingPath)) {
    log(`onnxruntime-node native binding is ready for ${tuple}.`);
    return;
  }

  const installedArchs = listInstalledOnnxArchs(packageDir);
  warn(
    `Missing onnxruntime-node native binding for ${tuple}. Installed ${process.platform} architectures: ${
      installedArchs.length > 0 ? installedArchs.join(", ") : "none"
    }.`,
  );

  rebuildOnnxRuntime();
  if (!existsSync(bindingPath)) {
    forceInstallNativeDeps();
  }

  if (existsSync(bindingPath)) {
    log(`onnxruntime-node native binding repaired for ${tuple}.`);
    return;
  }

  warn(
    "Local Whisper may be unavailable. Run `pnpm install --force --frozen-lockfile` with the same Node architecture used to run Marinara.",
  );
}

ensureOnnxRuntime();
