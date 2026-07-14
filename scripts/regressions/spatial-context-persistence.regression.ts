import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpatialContextDefinition, UpdateSpatialContextRequestInput } from "../../packages/shared/src/index.js";
import { createChatSchema } from "../../packages/shared/src/index.js";
import type { DB } from "../../packages/server/src/db/connection.js";
import { createFileNativeDB } from "../../packages/server/src/db/file-backed-store.js";
import { runMigrations } from "../../packages/server/src/db/migrate.js";
import * as dbSchema from "../../packages/server/src/db/schema/index.js";
import { chats, spatialContextSnapshots } from "../../packages/server/src/db/schema/index.js";
import {
  createSpatialContextService,
  SpatialContextServiceError,
} from "../../packages/server/src/services/spatial-context/definition.service.js";
import { createChatsStorage } from "../../packages/server/src/services/storage/chats.storage.js";
import { createGameStateStorage } from "../../packages/server/src/services/storage/game-state.storage.js";
import { createSpatialContextStorage } from "../../packages/server/src/services/storage/spatial-context.storage.js";

const storageDir = mkdtempSync(join(tmpdir(), "marinara-spatial-persistence-"));
process.env.FILE_STORAGE_DIR = storageDir;

const definition: SpatialContextDefinition = {
  schemaVersion: 1,
  ownerMode: "roleplay",
  enabled: true,
  revision: 0,
  startingLocationId: "tower",
  locations: [
    {
      id: "city",
      parentId: null,
      name: "City",
      kind: "settlement",
      description: "A crowded walled city.",
      childPresentation: "map",
      links: [],
      status: "active",
      sortOrder: 0,
    },
    {
      id: "tower",
      parentId: "city",
      name: "Tower",
      kind: "building",
      description: "An old stone tower.",
      modelMemory: "The tower belongs to the royal astronomer.",
      childPresentation: "list",
      placement: { x: 60, y: 25 },
      links: [],
      status: "active",
      sortOrder: 0,
    },
  ],
};

let fileDb = await createFileNativeDB();
let db = fileDb as unknown as DB;

try {
  const chatsStorage = createChatsStorage(db);
  const chat = await chatsStorage.create(
    createChatSchema.parse({
      name: "Spatial regression",
      mode: "roleplay",
      characterIds: [],
    }),
  );
  assert.ok(chat);

  const service = createSpatialContextService(db);
  const created = await service.update(chat.id, {
    expectedRevision: 0,
    expectedCurrentLocationId: null,
    definition,
  });
  assert.equal(created.definition?.revision, 1);
  assert.equal(created.currentLocationId, "tower");
  assert.deepEqual(
    created.breadcrumb.map((item) => item.id),
    ["city", "tower"],
  );

  await fileDb._fileStore.close();
  fileDb = await createFileNativeDB();
  db = fileDb as unknown as DB;

  const reopenedService = createSpatialContextService(db);
  const reopened = await reopenedService.get(chat.id);
  assert.equal(reopened.definition?.revision, 1);
  assert.equal(reopened.currentLocationId, "tower");
  assert.equal(reopened.destinations[0]?.id, "city");

  const rowsBefore = {
    chats: await db.select().from(chats),
    snapshots: await db.select().from(spatialContextSnapshots),
  };
  assert.equal(rowsBefore.snapshots.length, 1);
  assert.equal(rowsBefore.snapshots[0]?.source, "bootstrap");

  await assert.rejects(
    reopenedService.update(chat.id, {
      expectedRevision: 0,
      expectedCurrentLocationId: "tower",
      definition,
    }),
    (error: unknown) => error instanceof SpatialContextServiceError && error.code === "spatial_definition_stale",
  );

  const malformed = {
    expectedRevision: 1,
    expectedCurrentLocationId: "tower",
    definition: {
      ...definition,
      revision: 1,
      locations: [{ ...definition.locations[0], name: "" }],
    },
  } as UpdateSpatialContextRequestInput;
  await assert.rejects(
    reopenedService.update(chat.id, malformed),
    (error: unknown) => error instanceof SpatialContextServiceError && error.code === "spatial_replacement_invalid",
  );

  assert.deepEqual(await db.select().from(chats), rowsBefore.chats);
  assert.deepEqual(await db.select().from(spatialContextSnapshots), rowsBefore.snapshots);

  const updated = await reopenedService.update(chat.id, {
    expectedRevision: 1,
    expectedCurrentLocationId: "tower",
    replacementCurrentLocationId: "city",
    definition: {
      ...definition,
      revision: 1,
      locations: definition.locations.map((location) =>
        location.id === "tower" ? { ...location, description: "A restored observatory tower." } : location,
      ),
    },
  });
  assert.equal(updated.definition?.revision, 2);
  assert.equal(updated.currentLocationId, "tower");
  assert.equal((await db.select().from(spatialContextSnapshots)).length, 1);

  const historyAnchor = await createChatsStorage(db).createMessage({
    chatId: chat.id,
    role: "assistant",
    content: "The campaign begins in the tower.",
    characterId: null,
  });
  await createSpatialContextStorage(db).create({
    chatId: chat.id,
    messageId: historyAnchor.id,
    swipeIndex: 0,
    currentLocationId: "tower",
    definitionRevision: 2,
    source: "assistant_swipe",
  });
  assert.equal((await reopenedService.get(chat.id)).hasCommittedSpatialHistory, true);

  await assert.rejects(
    reopenedService.update(chat.id, {
      expectedRevision: 2,
      expectedCurrentLocationId: "tower",
      definition: {
        ...definition,
        revision: 2,
        locations: [{ ...definition.locations[1]!, parentId: null }],
      },
    }),
    (error: unknown) =>
      error instanceof SpatialContextServiceError && error.code === "spatial_history_location_removal_forbidden",
  );

  const expanded = await reopenedService.update(chat.id, {
    expectedRevision: 2,
    expectedCurrentLocationId: "tower",
    definition: {
      ...definition,
      revision: 2,
      locations: [
        ...definition.locations,
        {
          id: "observatory",
          parentId: "tower",
          name: "Observatory",
          kind: "room",
          description: "A brass-domed observatory.",
          childPresentation: "list",
          links: [],
          status: "active",
          sortOrder: 0,
        },
      ],
    },
  });
  assert.equal(expanded.definition?.revision, 3);
  assert.equal(expanded.hasCommittedSpatialHistory, true);
} finally {
  await fileDb._fileStore.close();
  rmSync(storageDir, { recursive: true, force: true });
}

const requireFromServer = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const { createClient } = requireFromServer("@libsql/client");
const { drizzle } = requireFromServer("drizzle-orm/libsql");
const legacyDir = mkdtempSync(join(tmpdir(), "marinara-spatial-libsql-"));
const legacyClient = createClient({ url: `file:${join(legacyDir, "spatial.db")}` });
const legacyDb = drizzle(legacyClient, { schema: dbSchema }) as unknown as DB;
try {
  await runMigrations(legacyDb);
  const legacyChat = await createChatsStorage(legacyDb).create(
    createChatSchema.parse({
      name: "Legacy spatial regression",
      mode: "game",
      characterIds: [],
    }),
  );
  assert.ok(legacyChat);

  const legacyService = createSpatialContextService(legacyDb);
  const gameDefinition: SpatialContextDefinition = { ...definition, ownerMode: "game" };
  const created = await legacyService.update(legacyChat.id, {
    expectedRevision: 0,
    expectedCurrentLocationId: null,
    definition: gameDefinition,
  });
  assert.equal(created.definition?.ownerMode, "game");
  assert.equal(created.currentLocationId, "tower");

  const trackerAnchor = await createChatsStorage(legacyDb).createMessage({
    chatId: legacyChat.id,
    role: "assistant",
    content: "Tracker anchor",
    characterId: null,
  });
  assert.ok(trackerAnchor);
  const clonedTracker = await createGameStateStorage(legacyDb).updateByMessage(
    trackerAnchor.id,
    0,
    legacyChat.id,
    { weather: "Rain" },
    true,
    { compatibilityLocation: "City > Tower" },
  );
  assert.equal(clonedTracker?.location, "City > Tower");
  assert.deepEqual(clonedTracker?.manualOverrides ? JSON.parse(clonedTracker.manualOverrides as string) : null, {
    weather: "Rain",
  });
  await createSpatialContextStorage(legacyDb).create({
    chatId: legacyChat.id,
    messageId: trackerAnchor.id,
    swipeIndex: 0,
    currentLocationId: "tower",
    definitionRevision: 1,
    source: "assistant_swipe",
  });
  assert.equal((await legacyService.get(legacyChat.id)).hasCommittedSpatialHistory, true);

  const rowsBefore = {
    chats: await legacyDb.select().from(chats),
    snapshots: await legacyDb.select().from(spatialContextSnapshots),
  };
  await assert.rejects(
    legacyService.update(legacyChat.id, {
      expectedRevision: 0,
      expectedCurrentLocationId: "tower",
      definition: gameDefinition,
    }),
    (error: unknown) => error instanceof SpatialContextServiceError && error.code === "spatial_definition_stale",
  );
  await assert.rejects(
    legacyService.update(legacyChat.id, {
      expectedRevision: 1,
      expectedCurrentLocationId: "tower",
      definition: {
        ...gameDefinition,
        locations: [{ ...gameDefinition.locations[0], name: "" }],
      },
    } as UpdateSpatialContextRequestInput),
    (error: unknown) => error instanceof SpatialContextServiceError && error.code === "spatial_replacement_invalid",
  );
  await assert.rejects(
    legacyService.update(legacyChat.id, {
      expectedRevision: 1,
      expectedCurrentLocationId: "tower",
      definition: {
        ...gameDefinition,
        locations: [{ ...gameDefinition.locations[1]!, parentId: null }],
      },
    }),
    (error: unknown) =>
      error instanceof SpatialContextServiceError && error.code === "spatial_history_location_removal_forbidden",
  );
  assert.deepEqual(await legacyDb.select().from(chats), rowsBefore.chats);
  assert.deepEqual(await legacyDb.select().from(spatialContextSnapshots), rowsBefore.snapshots);
} finally {
  legacyClient.close();
  rmSync(legacyDir, { recursive: true, force: true });
}

process.stdout.write("Spatial persistence regression passed.\n");
