import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DB } from "../../packages/server/src/db/connection.js";
import { createFileNativeDB } from "../../packages/server/src/db/file-backed-store.js";
import { createNoodleStorage } from "../../packages/server/src/services/storage/noodle.storage.js";

const storageDir = mkdtempSync(join(tmpdir(), "marinara-noodle-settings-"));
process.env.FILE_STORAGE_DIR = storageDir;

try {
  const firstDb = await createFileNativeDB();
  const firstNoodle = createNoodleStorage(firstDb as unknown as DB);
  const updated = await firstNoodle.updateSettings({
    maxImagesPerRefresh: 9,
    allowRandomUsers: true,
    maxGeneratedPostsPerRefresh: 11,
  });
  assert.equal(updated.maxImagesPerRefresh, 9);
  assert.equal(updated.allowRandomUsers, true);
  assert.equal(updated.maxGeneratedPostsPerRefresh, 11);
  await firstDb._fileStore.close();

  const reopenedDb = await createFileNativeDB();
  const reopenedSettings = await createNoodleStorage(reopenedDb as unknown as DB).getSettings();
  assert.equal(reopenedSettings.maxImagesPerRefresh, 9);
  assert.equal(reopenedSettings.allowRandomUsers, true);
  assert.equal(reopenedSettings.maxGeneratedPostsPerRefresh, 11);
  await reopenedDb._fileStore.close();
} finally {
  rmSync(storageDir, { recursive: true, force: true });
}

process.stdout.write("Noodle settings persistence regression passed.\n");
