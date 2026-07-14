import type { FastifyInstance, FastifyReply } from "fastify";
import {
  PROVIDERS,
  generateSpatialMapDraftRequestSchema,
  localAuthProviderBaseUrl,
  updateSpatialContextRequestSchema,
  type GenerateSpatialMapDraftResponse,
  type SpatialOwnerMode,
} from "@marinara-engine/shared";
import { isDebugAgentsEnabled } from "../config/runtime-config.js";
import { logger, logDebugOverride } from "../lib/logger.js";
import { parseGameJsonish } from "../services/game/jsonish.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import {
  buildSpatialMapDraftPrompt,
  buildSpatialMapExpansionPrompt,
  normalizeSpatialMapExpansionPlan,
  normalizeSpatialMapPlan,
} from "../services/spatial-context/ai-draft.js";
import {
  createSpatialContextService,
  SpatialContextServiceError,
} from "../services/spatial-context/definition.service.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";

interface ChatSpatialParams {
  chatId: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function excerpt(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

async function resolveDraftConnection(
  connections: ReturnType<typeof createConnectionsStorage>,
  requestedConnectionId: string | undefined,
  chatConnectionId: string | null,
) {
  let connectionId = requestedConnectionId ?? chatConnectionId ?? undefined;
  if (connectionId === "random") {
    const pool = await connections.listRandomPool();
    if (pool.length === 0) throw new Error("No language model connection is available in the random pool.");
    connectionId = pool[Math.floor(Math.random() * pool.length)]!.id;
  }
  if (!connectionId) {
    connectionId = (await connections.getDefault())?.id;
  }
  if (!connectionId) throw new Error("Choose a language model connection before generating a map.");
  const connection = await connections.getWithKey(connectionId);
  if (!connection) throw new Error("The selected language model connection no longer exists.");

  let baseUrl = connection.baseUrl;
  if (!baseUrl) {
    baseUrl = PROVIDERS[connection.provider as keyof typeof PROVIDERS]?.defaultBaseUrl ?? "";
  }
  if (!baseUrl) baseUrl = localAuthProviderBaseUrl(connection.provider) ?? "";
  if (!baseUrl) throw new Error("The selected connection has no base URL.");
  return { connection, baseUrl };
}

async function buildDraftSourceContext(
  chat: NonNullable<Awaited<ReturnType<ReturnType<typeof createChatsStorage>["getById"]>>>,
  characters: ReturnType<typeof createCharactersStorage>,
): Promise<string> {
  const metadata = record(chat.metadata);
  const setup = record(metadata.gameSetupConfig);
  const characterContext: Array<Record<string, string>> = [];
  for (const characterId of stringArray(chat.characterIds).slice(0, 8)) {
    if (characterId.startsWith("npc:")) continue;
    const character = await characters.getById(characterId);
    if (!character) continue;
    const data = record(character.data);
    characterContext.push({
      name: excerpt(data.name, 200) ?? "Character",
      ...(excerpt(data.description, 1_200) ? { description: excerpt(data.description, 1_200)! } : {}),
      ...(excerpt(data.personality, 800) ? { personality: excerpt(data.personality, 800)! } : {}),
      ...(excerpt(data.scenario, 1_000) ? { scenario: excerpt(data.scenario, 1_000)! } : {}),
    });
  }

  const source =
    chat.mode === "game"
      ? {
          chatName: chat.name,
          mode: chat.mode,
          setup: {
            genre: excerpt(setup.genre, 300),
            setting: excerpt(setup.setting, 2_000),
            tone: excerpt(setup.tone, 500),
            playerGoals: excerpt(setup.playerGoals, 1_200),
            specialInstructions: excerpt(setup.gameSpecialInstructions, 1_200),
          },
          worldOverview: excerpt(metadata.gameWorldOverview, 3_000),
          storyArc: excerpt(metadata.gameStoryArc, 2_000),
          characters: characterContext,
        }
      : {
          chatName: chat.name,
          mode: chat.mode,
          scenario:
            excerpt(metadata.sceneDescription, 2_000) ??
            excerpt(metadata.roleplayScenario, 2_000) ??
            excerpt(metadata.scenario, 2_000),
          characters: characterContext,
        };
  return JSON.stringify(source, null, 2).slice(0, 16_000);
}

function sendServiceError(reply: FastifyReply, error: unknown) {
  if (error instanceof SpatialContextServiceError) {
    return reply.status(error.statusCode).send({ error: error.message, code: error.code });
  }
  throw error;
}

export async function spatialContextRoutes(app: FastifyInstance) {
  const service = createSpatialContextService(app.db);
  const chats = createChatsStorage(app.db);
  const connections = createConnectionsStorage(app.db);
  const characters = createCharactersStorage(app.db);

  app.get<{ Params: ChatSpatialParams }>("/:chatId/spatial-context", async (req, reply) => {
    try {
      return await service.get(req.params.chatId);
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.put<{ Params: ChatSpatialParams }>("/:chatId/spatial-context", async (req, reply) => {
    const parsed = updateSpatialContextRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message ?? "Invalid hierarchical map.",
        code: "spatial_request_invalid",
        issues: parsed.error.issues,
      });
    }

    try {
      return await service.update(req.params.chatId, parsed.data);
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.post<{ Params: ChatSpatialParams }>("/:chatId/spatial-context/generate", async (req, reply) => {
    const parsed = generateSpatialMapDraftRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message ?? "Invalid map generation request.",
        code: "spatial_ai_request_invalid",
        issues: parsed.error.issues,
      });
    }

    let spatial;
    try {
      spatial = await service.get(req.params.chatId);
    } catch (error) {
      return sendServiceError(reply, error);
    }
    const chat = await chats.getById(req.params.chatId);
    if (!chat) {
      return reply.status(404).send({ error: "Chat not found.", code: "spatial_chat_missing" });
    }
    const ownerMode = chat.mode as SpatialOwnerMode;
    const operation = parsed.data.operation;
    const existingDefinition = spatial.definition;
    const hasExistingMap = Boolean(existingDefinition?.locations.length);
    if (operation === "create" && hasExistingMap) {
      return reply.status(409).send({
        error: "This chat already has a hierarchical map. Expand it, or replace it before campaign history begins.",
        code: "spatial_ai_map_already_exists",
      });
    }
    if (operation === "replace" && !hasExistingMap) {
      return reply.status(409).send({
        error: "There is no existing map to replace. Create the first map instead.",
        code: "spatial_ai_map_missing",
      });
    }
    if (operation === "replace" && spatial.hasCommittedSpatialHistory) {
      return reply.status(409).send({
        error: "Campaign history uses this map. Expand it instead of replacing existing location IDs.",
        code: "spatial_ai_replacement_protected",
      });
    }
    if (operation === "expand" && !hasExistingMap) {
      return reply.status(409).send({
        error: "Create the first map before expanding it.",
        code: "spatial_ai_map_missing",
      });
    }
    if (
      operation === "expand" &&
      !existingDefinition?.locations.some(
        (location) => location.id === parsed.data.targetLocationId && location.status === "active",
      )
    ) {
      return reply.status(400).send({
        error: "Choose an active location to expand.",
        code: "spatial_ai_target_invalid",
      });
    }

    let resolved;
    try {
      resolved = await resolveDraftConnection(connections, parsed.data.connectionId, chat.connectionId);
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "A language model connection is required.",
        code: "spatial_ai_connection_invalid",
      });
    }

    const sourceContext = await buildDraftSourceContext(chat, characters);
    let prompt;
    try {
      prompt =
        operation === "expand"
          ? buildSpatialMapExpansionPrompt({
              definition: existingDefinition!,
              targetLocationId: parsed.data.targetLocationId!,
              size: parsed.data.size,
              sourceContext,
              instructions: parsed.data.instructions,
            })
          : buildSpatialMapDraftPrompt({
              ownerMode,
              size: parsed.data.size,
              sourceContext,
              instructions: parsed.data.instructions,
            });
    } catch (error) {
      return reply.status(409).send({
        error: error instanceof Error ? error.message : "This location cannot be expanded.",
        code: "spatial_ai_expansion_unavailable",
      });
    }
    const debugOverrideEnabled = parsed.data.debugMode || isDebugAgentsEnabled();
    logDebugOverride(
      debugOverrideEnabled,
      "[debug/spatial/map-draft] final prompt chatId=%s model=%s:\n%s",
      chat.id,
      resolved.connection.model ?? "",
      JSON.stringify(prompt.messages, null, 2),
    );

    try {
      const provider = createLLMProvider(
        resolved.connection.provider,
        resolved.baseUrl,
        resolved.connection.apiKey,
        resolved.connection.maxContext,
        resolved.connection.openrouterProvider,
        resolved.connection.maxTokensOverride,
        resolved.connection.claudeFastMode === "true",
        resolved.connection.treatAsLocalEndpoint === "true",
      );
      const result = await provider.chatComplete(prompt.messages, {
        model: resolved.connection.model,
        temperature: 0.55,
        maxTokens: prompt.maxTokens,
        debugMode: debugOverrideEnabled,
      });
      const raw = result.content?.trim();
      if (!raw) throw new Error("The model returned an empty response.");
      logDebugOverride(
        debugOverrideEnabled,
        "[debug/spatial/map-draft] raw response chatId=%s chars=%d:\n%s",
        chat.id,
        raw.length,
        raw,
      );
      const parsedPlan = parseGameJsonish(raw);
      const definition =
        operation === "expand"
          ? normalizeSpatialMapExpansionPlan(parsedPlan, {
              definition: existingDefinition!,
              targetLocationId: parsed.data.targetLocationId!,
              size: parsed.data.size,
            })
          : normalizeSpatialMapPlan(parsedPlan, {
              ownerMode,
              revision: existingDefinition?.revision ?? 0,
              enabled: existingDefinition?.enabled ?? false,
              size: parsed.data.size,
            });
      const generatedLocationCount =
        operation === "expand"
          ? definition.locations.length - existingDefinition!.locations.length
          : definition.locations.length;
      logger.info(
        "[spatial/map-draft] Generated %d %s locations for chat %s with model %s",
        generatedLocationCount,
        operation,
        chat.id,
        resolved.connection.model ?? "",
      );
      return {
        definition,
        operation,
        size: parsed.data.size,
        source: ownerMode === "game" ? "game_setup" : "roleplay_setup",
        generatedLocationCount,
        ...(operation === "expand" ? { targetLocationId: parsed.data.targetLocationId } : {}),
      } satisfies GenerateSpatialMapDraftResponse;
    } catch (error) {
      logger.error(error, "[spatial/map-draft] Generation failed for chat %s", chat.id);
      return reply.status(502).send({
        error:
          "The AI could not create a valid map draft. Try again, add clearer instructions, or choose a smaller size.",
        code: "spatial_ai_generation_failed",
      });
    }
  });
}
