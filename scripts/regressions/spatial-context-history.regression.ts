import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PendingSpatialTransition,
  SpatialContextDefinition,
  SpatialLocation,
} from "../../packages/shared/src/index.js";
import { createChatSchema } from "../../packages/shared/src/index.js";
import type { DB } from "../../packages/server/src/db/connection.js";
import { createFileNativeDB } from "../../packages/server/src/db/file-backed-store.js";
import { gameCheckpoints, messages, spatialContextSnapshots } from "../../packages/server/src/db/schema/index.js";
import { chatsRoutes } from "../../packages/server/src/routes/chats.routes.js";
import { gameRoutes } from "../../packages/server/src/routes/game.routes.js";
import { createCheckpointService } from "../../packages/server/src/services/game/checkpoint.service.js";
import { importSTChat } from "../../packages/server/src/services/import/st-chat.importer.js";
import {
  commitSpatialOwnerTurn,
  SpatialOwnerTurnError,
} from "../../packages/server/src/services/spatial-context/owner-turn.js";
import {
  materializeAssistantSpatialState,
  resolveEffectiveSpatialState,
} from "../../packages/server/src/services/spatial-context/state-resolution.js";
import { createSpatialContextService } from "../../packages/server/src/services/spatial-context/definition.service.js";
import { createChatsStorage } from "../../packages/server/src/services/storage/chats.storage.js";
import { createGameStateStorage } from "../../packages/server/src/services/storage/game-state.storage.js";
import { createSpatialContextStorage } from "../../packages/server/src/services/storage/spatial-context.storage.js";

const storageDir = mkdtempSync(join(tmpdir(), "marinara-spatial-history-"));
process.env.FILE_STORAGE_DIR = storageDir;

const requireFromServer = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const Fastify = requireFromServer("fastify") as (options?: Record<string, unknown>) => any;

function location(
  id: string,
  name: string,
  overrides: Partial<Omit<SpatialLocation, "id" | "name">> = {},
): SpatialLocation {
  return {
    id,
    name,
    parentId: null,
    kind: "place",
    description: "Spatial regression location.",
    childPresentation: "list",
    links: [],
    status: "active",
    sortOrder: 0,
    ...overrides,
  };
}

function definition(ownerMode: "roleplay" | "game"): SpatialContextDefinition {
  return {
    schemaVersion: 1,
    ownerMode,
    enabled: true,
    revision: 0,
    startingLocationId: "atrium",
    locations: [
      location("world", "World", { kind: "region" }),
      location("atrium", "Atrium", {
        parentId: "world",
        links: [
          {
            targetId: "archive",
            label: "East hall",
            bidirectional: true,
            state: "available",
          },
        ],
      }),
      location("archive", "Archive", {
        parentId: "world",
        modelMemory: "Only the current archive memory should be active.",
      }),
    ],
  };
}

function transition(
  destinationId: string,
  expectedCurrentLocationId: string,
  commandId: string,
): PendingSpatialTransition {
  return {
    destinationId,
    expectedDefinitionRevision: 1,
    expectedCurrentLocationId,
    commandId,
  };
}

async function expectOwnerError(operation: Promise<unknown>, code: SpatialOwnerTurnError["code"]): Promise<void> {
  await assert.rejects(operation, (error: unknown) => error instanceof SpatialOwnerTurnError && error.code === code);
}

async function nextTimestamp(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 2));
}

let fileDb = await createFileNativeDB();
let db = fileDb as unknown as DB;
let chatsApp: any = null;
let gameApp: any = null;

try {
  let chatStorage = createChatsStorage(db);
  const roleplayChat = await chatStorage.create(
    createChatSchema.parse({
      name: "Spatial history regression",
      mode: "roleplay",
      characterIds: [],
    }),
  );
  assert.ok(roleplayChat);

  const roleplayDefinition = await createSpatialContextService(db).update(roleplayChat.id, {
    expectedRevision: 0,
    expectedCurrentLocationId: null,
    definition: definition("roleplay"),
  });
  assert.equal(roleplayDefinition.currentLocationId, "atrium");

  const firstMove = transition("archive", "atrium", "move-to-archive");
  const firstOwnerTurn = await commitSpatialOwnerTurn(db, {
    chatId: roleplayChat.id,
    content: "I enter the archive.",
    transition: firstMove,
  });
  assert.equal(firstOwnerTurn.snapshot.currentLocationId, "archive");
  assert.equal(firstOwnerTurn.snapshot.source, "owner_turn");
  assert.match(firstOwnerTurn.snapshot.transitionPayloadHash ?? "", /^[a-f0-9]{64}$/u);

  const countsAfterFirstMove = {
    messages: (await db.select().from(messages)).length,
    snapshots: (await db.select().from(spatialContextSnapshots)).length,
  };
  await expectOwnerError(
    commitSpatialOwnerTurn(db, {
      chatId: roleplayChat.id,
      content: "I enter the archive.",
      transition: firstMove,
    }),
    "spatial_transition_already_applied",
  );
  await expectOwnerError(
    commitSpatialOwnerTurn(db, {
      chatId: roleplayChat.id,
      content: "Reuse the command elsewhere.",
      transition: { ...firstMove, destinationId: "world" },
    }),
    "spatial_transition_command_mismatch",
  );
  await expectOwnerError(
    commitSpatialOwnerTurn(db, {
      chatId: roleplayChat.id,
      content: "Use stale state.",
      transition: transition("world", "atrium", "stale-location"),
    }),
    "spatial_transition_stale_location",
  );
  assert.equal((await db.select().from(messages)).length, countsAfterFirstMove.messages);
  assert.equal((await db.select().from(spatialContextSnapshots)).length, countsAfterFirstMove.snapshots);

  await fileDb._fileStore.close();
  fileDb = await createFileNativeDB();
  db = fileDb as unknown as DB;
  chatStorage = createChatsStorage(db);

  let effective = await resolveEffectiveSpatialState(db, roleplayChat.id);
  assert.equal(effective.currentLocationId, "archive");
  assert.equal((await chatStorage.listMessages(roleplayChat.id)).length, 1);

  await nextTimestamp();
  const firstAssistant = await chatStorage.createMessage({
    chatId: roleplayChat.id,
    role: "assistant",
    characterId: null,
    content: "The archive doors close behind you.",
  });
  assert.ok(firstAssistant);
  await materializeAssistantSpatialState(db, {
    chatId: roleplayChat.id,
    messageId: firstAssistant.id,
    swipeIndex: 0,
    regenerate: false,
    continuation: false,
  });
  const regeneratedSwipe = await chatStorage.addSwipe(firstAssistant.id, "Regenerated archive response.");
  const regeneratedSnapshot = await materializeAssistantSpatialState(db, {
    chatId: roleplayChat.id,
    messageId: firstAssistant.id,
    swipeIndex: regeneratedSwipe.index,
    regenerate: true,
    continuation: false,
  });
  assert.equal(regeneratedSnapshot?.currentLocationId, "archive");

  await nextTimestamp();
  await commitSpatialOwnerTurn(db, {
    chatId: roleplayChat.id,
    content: "I return to the atrium.",
    transition: transition("atrium", "archive", "return-to-atrium"),
  });
  await nextTimestamp();
  const secondAssistant = await chatStorage.createMessage({
    chatId: roleplayChat.id,
    role: "assistant",
    characterId: null,
    content: "You return to the atrium.",
  });
  assert.ok(secondAssistant);
  await materializeAssistantSpatialState(db, {
    chatId: roleplayChat.id,
    messageId: secondAssistant.id,
    swipeIndex: 0,
    regenerate: false,
    continuation: false,
  });

  const alternate = await chatStorage.addSwipe(secondAssistant.id, "An alternate spatial branch.");
  await createSpatialContextStorage(db).replaceAtAnchor({
    chatId: roleplayChat.id,
    messageId: secondAssistant.id,
    swipeIndex: alternate.index,
    currentLocationId: "archive",
    definitionRevision: 1,
    source: "assistant_swipe",
    transitionCommandId: null,
    transitionPayloadHash: null,
  });
  effective = await resolveEffectiveSpatialState(db, roleplayChat.id);
  assert.equal(effective.currentLocationId, "archive");

  await chatStorage.setActiveSwipe(secondAssistant.id, 0);
  effective = await resolveEffectiveSpatialState(db, roleplayChat.id);
  assert.equal(effective.currentLocationId, "atrium");
  await chatStorage.setActiveSwipe(secondAssistant.id, alternate.index);
  const continued = await materializeAssistantSpatialState(db, {
    chatId: roleplayChat.id,
    messageId: secondAssistant.id,
    swipeIndex: alternate.index,
    regenerate: false,
    continuation: true,
  });
  assert.equal(continued?.currentLocationId, "archive");

  await chatStorage.setActiveSwipe(secondAssistant.id, 0);
  await nextTimestamp();
  const failedProviderTurn = await commitSpatialOwnerTurn(db, {
    chatId: roleplayChat.id,
    content: "I go back without waiting for a reply.",
    transition: transition("archive", "atrium", "provider-failure-anchor"),
  });
  assert.equal(failedProviderTurn.snapshot.currentLocationId, "archive");

  await fileDb._fileStore.close();
  fileDb = await createFileNativeDB();
  db = fileDb as unknown as DB;
  effective = await resolveEffectiveSpatialState(db, roleplayChat.id);
  assert.equal(effective.currentLocationId, "archive");
  assert.equal(effective.snapshot?.messageId, failedProviderTurn.message.id);

  chatsApp = Fastify({ logger: false });
  chatsApp.decorate("db", db);
  await chatsApp.register(chatsRoutes);
  await chatsApp.ready();

  const branchResponse = await chatsApp.inject({
    method: "POST",
    url: `/${roleplayChat.id}/branch`,
    payload: { upToMessageId: firstAssistant.id },
  });
  assert.equal(branchResponse.statusCode, 200, branchResponse.body);
  const branchedChat = branchResponse.json() as { id: string };
  const branchedState = await resolveEffectiveSpatialState(db, branchedChat.id);
  assert.equal(branchedState.currentLocationId, "archive");
  assert.equal((await createChatsStorage(db).listMessages(branchedChat.id)).length, 2);
  assert.ok(await createSpatialContextStorage(db).getBootstrap(branchedChat.id));

  const exportResponse = await chatsApp.inject({
    method: "GET",
    url: `/${roleplayChat.id}/export?format=jsonl`,
  });
  assert.equal(exportResponse.statusCode, 200, exportResponse.body);
  const exportLines = exportResponse.body.split("\n");
  const exportHeader = JSON.parse(exportLines[0]!) as {
    chat_metadata?: {
      marinara_metadata?: {
        spatialContext?: SpatialContextDefinition;
        spatialContextHistory?: unknown[];
      };
    };
  };
  assert.equal(exportHeader.chat_metadata?.marinara_metadata?.spatialContext?.ownerMode, "roleplay");
  assert.ok((exportHeader.chat_metadata?.marinara_metadata?.spatialContextHistory?.length ?? 0) >= 5);

  const imported = await importSTChat(exportResponse.body, db, {
    mode: "roleplay",
    chatName: "Imported spatial history",
    characterIds: [],
  });
  assert.ok("chatId" in imported, JSON.stringify(imported));
  const importedState = await resolveEffectiveSpatialState(db, (imported as { chatId: string }).chatId);
  assert.equal(importedState.currentLocationId, "archive");

  const gameChat = await createChatsStorage(db).create(
    createChatSchema.parse({
      name: "Spatial checkpoint regression",
      mode: "game",
      characterIds: [],
    }),
  );
  assert.ok(gameChat);
  await createSpatialContextService(db).update(gameChat.id, {
    expectedRevision: 0,
    expectedCurrentLocationId: null,
    definition: definition("game"),
  });
  const gameMove = await commitSpatialOwnerTurn(db, {
    chatId: gameChat.id,
    content: "Enter the archive.",
    transition: transition("archive", "atrium", "game-enter-archive"),
  });
  await nextTimestamp();
  const gameAssistant = await createChatsStorage(db).createMessage({
    chatId: gameChat.id,
    role: "assistant",
    characterId: null,
    content: "The party enters the archive.",
  });
  assert.ok(gameAssistant);
  const gameSpatialSnapshot = await materializeAssistantSpatialState(db, {
    chatId: gameChat.id,
    messageId: gameAssistant.id,
    swipeIndex: 0,
    regenerate: false,
    continuation: false,
  });
  assert.equal(gameSpatialSnapshot?.currentLocationId, "archive");

  const gameStateSnapshotId = await createGameStateStorage(db).create({
    chatId: gameChat.id,
    messageId: gameAssistant.id,
    swipeIndex: 0,
    date: null,
    time: "Night",
    location: "Legacy tracker location",
    weather: null,
    temperature: null,
    worldCustomFields: [],
    presentCharacters: [],
    recentEvents: [],
    playerStats: null,
    personaStats: null,
    fieldLocks: {},
    hiddenTrackerFields: {},
    committed: false,
  });

  gameApp = Fastify({ logger: false });
  gameApp.decorate("db", db);
  await gameApp.register(gameRoutes);
  await gameApp.ready();

  const checkpointResponse = await gameApp.inject({
    method: "POST",
    url: "/checkpoint",
    payload: {
      chatId: gameChat.id,
      label: "Archive checkpoint",
      triggerType: "manual",
    },
  });
  assert.equal(checkpointResponse.statusCode, 200, checkpointResponse.body);
  const checkpointId = (checkpointResponse.json() as { id: string }).id;
  const checkpoint = await createCheckpointService(db).getById(checkpointId);
  assert.equal(checkpoint?.spatialSnapshotId, gameSpatialSnapshot?.id);
  assert.equal((await db.select().from(gameCheckpoints)).length, 1);
  await expectOwnerError(
    commitSpatialOwnerTurn(db, {
      chatId: gameChat.id,
      content: "Reject stale Game movement.",
      transition: transition("atrium", "atrium", "game-stale-location"),
      gameStateSnapshotId,
    }),
    "spatial_transition_stale_location",
  );
  assert.equal((await createGameStateStorage(db).getById(gameStateSnapshotId))?.committed, 0);

  await nextTimestamp();
  await commitSpatialOwnerTurn(db, {
    chatId: gameChat.id,
    content: "Return to the atrium.",
    transition: transition("atrium", "archive", "game-return-atrium"),
    gameStateSnapshotId,
  });
  assert.equal((await resolveEffectiveSpatialState(db, gameChat.id)).currentLocationId, "atrium");
  assert.equal((await createGameStateStorage(db).getById(gameStateSnapshotId))?.committed, 1);

  await nextTimestamp();
  const loadResponse = await gameApp.inject({
    method: "POST",
    url: "/checkpoint/load",
    payload: {
      chatId: gameChat.id,
      checkpointId,
    },
  });
  assert.equal(loadResponse.statusCode, 200, loadResponse.body);
  const restoredState = await resolveEffectiveSpatialState(db, gameChat.id);
  assert.equal(restoredState.currentLocationId, "archive");
  assert.equal(restoredState.snapshot?.messageId, (loadResponse.json() as { messageId: string }).messageId);
  assert.notEqual(restoredState.snapshot?.id, gameMove.snapshot.id);

  process.stdout.write("Spatial history regression passed.\n");
} finally {
  await chatsApp?.close();
  await gameApp?.close();
  await fileDb._fileStore.close();
  rmSync(storageDir, { recursive: true, force: true });
}
