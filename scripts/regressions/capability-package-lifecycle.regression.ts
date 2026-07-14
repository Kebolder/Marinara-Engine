import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "marinara-capability-lifecycle-"));
process.env.DATA_DIR = dataDir;

const packagesRoot = join(dataDir, "capability-packages");
const registryPath = join(packagesRoot, "installed.json");
const modelsRoot = join(dataDir, "models");
const speechConfigPath = join(modelsRoot, "sidecar-speech-config.json");

function installedPackage(id: string, kind: string[]) {
  return {
    id,
    version: "1.0.0",
    manifest: {
      schemaVersion: 1,
      id,
      name: id,
      version: "1.0.0",
      description: "Capability lifecycle regression fixture.",
      engine: { min: "2.3.0", maxExclusive: "3.0.0" },
      kind,
      entrypoints: { server: "server.mjs" },
      files: [{ path: "server.mjs", sha256: "0".repeat(64), bytes: 1 }],
      permissions: ["ui"],
      restartRequired: true,
    },
    installedAt: "2026-07-14T00:00:00.000Z",
    status: "active",
    error: null,
    legacy: false,
  };
}

function writeRegistry(packages: ReturnType<typeof installedPackage>[]) {
  mkdirSync(packagesRoot, { recursive: true });
  writeFileSync(registryPath, JSON.stringify({ schemaVersion: 1, packages }, null, 2));
  for (const item of packages) {
    const versionRoot = join(packagesRoot, "versions", item.id, item.version);
    mkdirSync(versionRoot, { recursive: true });
    writeFileSync(join(versionRoot, "server.mjs"), "x");
  }
}

function seedWhisperModels() {
  for (const modelName of ["whisper-tiny", "whisper-base"]) {
    const modelRoot = join(modelsRoot, "Xenova", modelName);
    mkdirSync(modelRoot, { recursive: true });
    writeFileSync(join(modelRoot, "model.onnx"), "fixture");
  }
  writeFileSync(speechConfigPath, JSON.stringify({ modelId: "whisper_tiny" }));
}

try {
  writeRegistry([installedPackage("conversation-calls", ["agent", "conversation-calls"])]);
  seedWhisperModels();

  const { capabilityPackageManager } = await import(
    "../../packages/server/src/services/capability-packages/package-manager.service.js"
  );
  const removedCalls = await capabilityPackageManager.uninstall("conversation-calls");
  assert.ok(removedCalls, "Conversation Calls should be removed");
  assert.equal(existsSync(join(modelsRoot, "Xenova", "whisper-tiny")), false);
  assert.equal(existsSync(join(modelsRoot, "Xenova", "whisper-base")), false);
  assert.equal(existsSync(speechConfigPath), false);
  assert.equal(existsSync(join(packagesRoot, "versions", "conversation-calls")), false);
  assert.deepEqual(JSON.parse(readFileSync(registryPath, "utf8")).packages, []);

  writeRegistry([installedPackage("uno", ["agent", "turn-game"])]);
  seedWhisperModels();
  const removedUno = await capabilityPackageManager.uninstall("uno");
  assert.ok(removedUno, "Unrelated packages should still be removed");
  assert.equal(
    existsSync(join(modelsRoot, "Xenova", "whisper-tiny")),
    true,
    "Uninstalling a package other than Conversation Calls must preserve Whisper",
  );

  console.info("Capability-owned Local Whisper lifecycle regression passed.");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
