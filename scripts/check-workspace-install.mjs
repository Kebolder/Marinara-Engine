import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";

const root = process.cwd();
const supportedOnnxTuples = new Set(["darwin/arm64", "darwin/x64", "linux/arm64", "linux/x64", "win32/arm64", "win32/x64"]);
const checks = [
  { workspace: ".", packageName: "esbuild" },
  { workspace: "packages/shared", packageName: "chess.js" },
  { workspace: "packages/server", packageName: "pino" },
  { workspace: "packages/client", packageName: "react" },
];

const missing = [];

for (const check of checks) {
  const requireFromWorkspace = createRequire(resolve(root, check.workspace, "package.json"));
  try {
    requireFromWorkspace.resolve(check.packageName);
  } catch {
    missing.push(`${check.packageName} from ${check.workspace}`);
  }
}

const onnxTuple = `${process.platform}/${process.arch}`;
if (supportedOnnxTuples.has(onnxTuple)) {
  const requireFromServer = createRequire(resolve(root, "packages/server/package.json"));
  try {
    const packageDir = dirname(requireFromServer.resolve("onnxruntime-node/package.json"));
    const bindingPath = join(packageDir, "bin", "napi-v6", process.platform, process.arch, "onnxruntime_binding.node");
    if (!existsSync(bindingPath)) {
      missing.push(`onnxruntime-node native binding for ${onnxTuple}`);
    }
  } catch {
    missing.push(`onnxruntime-node from packages/server`);
  }
}

if (missing.length > 0) {
  console.error(`Incomplete Marinara dependency install. Missing: ${missing.join(", ")}`);
  process.exit(1);
}
