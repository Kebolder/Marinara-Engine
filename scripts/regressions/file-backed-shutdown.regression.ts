import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "../../packages/server/node_modules/drizzle-orm/index.js";
import { sqliteTable, text } from "../../packages/server/node_modules/drizzle-orm/sqlite-core/index.js";
import { createFileNativeDB } from "../../packages/server/src/db/file-backed-store.js";
import { appSettings } from "../../packages/server/src/db/schema/index.js";

const storageDir = mkdtempSync(join(tmpdir(), "marinara-file-close-"));
process.env.FILE_STORAGE_DIR = storageDir;

let releaseWrite!: () => void;
const writeGate = new Promise<void>((resolve) => {
  releaseWrite = resolve;
});
let capturedWrite!: () => void;
const writeCaptured = new Promise<void>((resolve) => {
  capturedWrite = resolve;
});
let blockedFirstSettingsWrite = false;

try {
  const db = await createFileNativeDB([], {
    beforeTableWrite: async (table) => {
      if (table !== "app_settings" || blockedFirstSettingsWrite) return;
      blockedFirstSettingsWrite = true;
      capturedWrite();
      await writeGate;
    },
  });

  await db.insert(appSettings).values({ key: "before-active-flush", value: "one", updatedAt: "2026-07-14" });
  const activeFlush = db._fileStore.flush();
  await writeCaptured;

  await db.insert(appSettings).values({ key: "queued-during-flush", value: "two", updatedAt: "2026-07-14" });
  let closeResolved = false;
  const close = db._fileStore.close().then(() => {
    closeResolved = true;
  });
  await Promise.resolve();
  assert.equal(closeResolved, false, "close must wait for the active table write");

  releaseWrite();
  await Promise.all([activeFlush, close]);

  const persisted = JSON.parse(readFileSync(join(storageDir, "tables", "app_settings.json"), "utf8")) as Array<{
    key: string;
  }>;
  assert.deepEqual(
    persisted.map((row) => row.key).sort(),
    ["before-active-flush", "queued-during-flush"],
  );
  console.info("File-backed graceful shutdown regression passed.");
} finally {
  releaseWrite();
  rmSync(storageDir, { recursive: true, force: true });
}

const failingStorageDir = mkdtempSync(join(tmpdir(), "marinara-file-close-failure-"));
process.env.FILE_STORAGE_DIR = failingStorageDir;
try {
  const expectedFailure = new Error("simulated persistent write failure");
  const db = await createFileNativeDB([], {
    beforeTableWrite: (table) => {
      if (table === "app_settings") throw expectedFailure;
    },
  });
  await db.insert(appSettings).values({ key: "must-report-failure", value: "one", updatedAt: "2026-07-14" });
  await assert.rejects(db._fileStore.close(), expectedFailure);
} finally {
  rmSync(failingStorageDir, { recursive: true, force: true });
}

const packagedSchemaStorageDir = mkdtempSync(join(tmpdir(), "marinara-file-package-schema-"));
process.env.FILE_STORAGE_DIR = packagedSchemaStorageDir;
try {
  // Capability bundles contain their own Drizzle schema instances. Their table
  // and column objects have different identities even though they target the
  // same registered Engine tables.
  const packagedChats = sqliteTable("chats", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    mode: text("mode").notNull(),
    characterIds: text("character_ids").notNull().default("[]"),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  });
  const packagedCallSessions = sqliteTable("conversation_call_sessions", {
    id: text("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    status: text("status").notNull(),
    mode: text("mode").notNull().default("audio"),
    initiator: text("initiator").notNull(),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  });

  const db = await createFileNativeDB();
  await db.insert(packagedChats).values({
    id: "package-chat",
    name: "Package Schema Chat",
    mode: "conversation",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  });
  await db.insert(packagedCallSessions).values({
    id: "package-call",
    chatId: "package-chat",
    status: "active",
    initiator: "user",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  });
  const calls = await db
    .select({ id: packagedCallSessions.id, chatId: packagedCallSessions.chatId })
    .from(packagedCallSessions)
    .where(eq(packagedCallSessions.chatId, "package-chat"));
  assert.deepEqual(calls, [{ id: "package-call", chatId: "package-chat" }]);
  await db._fileStore.close();
  console.info("File-backed capability schema identity regression passed.");
} finally {
  rmSync(packagedSchemaStorageDir, { recursive: true, force: true });
}
