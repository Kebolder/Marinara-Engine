import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DB } from "../../packages/server/src/db/connection.js";
import { createFileNativeDB } from "../../packages/server/src/db/file-backed-store.js";
import { createNoodleStorage } from "../../packages/server/src/services/storage/noodle.storage.js";
import { resolveNoodleAvatarCropAfterProfileUpdate } from "../../packages/server/src/services/noodle/noodle-profile-avatar.js";

const sourceCrop = { x: 12, y: 18, width: 62, height: 62, unit: "%" as const };
assert.equal(
  resolveNoodleAvatarCropAfterProfileUpdate({
    currentAvatarUrl: "/avatar.png",
    nextAvatarUrl: undefined,
    currentCrop: sourceCrop,
  }),
  undefined,
);
assert.deepEqual(
  resolveNoodleAvatarCropAfterProfileUpdate({
    currentAvatarUrl: "/avatar.png",
    nextAvatarUrl: "/avatar.png",
    currentCrop: sourceCrop,
  }),
  sourceCrop,
);
assert.deepEqual(
  resolveNoodleAvatarCropAfterProfileUpdate({
    currentAvatarUrl: "/avatar.png",
    nextAvatarUrl: undefined,
    currentCrop: null,
    sourceAvatarUrl: "/avatar.png",
    sourceCrop,
  }),
  sourceCrop,
);
assert.deepEqual(
  resolveNoodleAvatarCropAfterProfileUpdate({
    currentAvatarUrl: "/avatar.png",
    nextAvatarUrl: "/avatar.png",
    currentCrop: null,
    sourceAvatarUrl: "/avatar.png",
    sourceCrop,
  }),
  sourceCrop,
);
assert.equal(
  resolveNoodleAvatarCropAfterProfileUpdate({
    currentAvatarUrl: "/avatar.png",
    nextAvatarUrl: "/replacement.png",
    currentCrop: sourceCrop,
  }),
  null,
);

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
  const characterAccount = await firstNoodle.upsertAccountFromProfile({
    kind: "character",
    entityId: "renamed-character",
    displayName: "Old Card Name",
    avatarUrl: "/old-avatar.png",
    bio: "Generated Noodle biography",
    invited: true,
    syncIdentity: true,
  });
  await firstNoodle.updateAccount(characterAccount.id, {
    displayName: "Generated Social Name",
    handle: "custom_handle",
    bio: "Keep this generated biography",
    settings: { profileGenerated: true, location: "Snezhnaya" },
  });
  const renamedCharacterAccount = await firstNoodle.upsertAccountFromProfile({
    kind: "character",
    entityId: "renamed-character",
    displayName: "New Card Name",
    avatarUrl: "/new-avatar.png",
    syncIdentity: true,
  });
  assert.equal(renamedCharacterAccount.displayName, "New Card Name");
  assert.equal(renamedCharacterAccount.avatarUrl, "/new-avatar.png");
  assert.equal(renamedCharacterAccount.handle, "custom_handle");
  assert.equal(renamedCharacterAccount.bio, "Keep this generated biography");
  assert.deepEqual(renamedCharacterAccount.settings, { profileGenerated: true, location: "Snezhnaya" });
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
