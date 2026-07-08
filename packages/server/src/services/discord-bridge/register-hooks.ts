// ──────────────────────────────────────────────
// Discord Bridge — Generation Hook Registration
// ──────────────────────────────────────────────
//
// Wires the Discord bridge's prompt/message behaviour into core generation via
// the generic registry in services/generation/content-hooks. This file is the
// single seam where bridge logic attaches to core; core files never import the
// bridge directly. Invoked once at server startup (see discord-bridge.routes.ts)
// with the app db so per-request providers can read bridge storage.

import { createHash } from "crypto";
import {
  formatParticipantTrackerField,
  splitParticipantTrackerFields,
  type CustomTrackerField,
} from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import {
  registerBridgeTurnFactory,
  registerHistoryContentTransform,
  registerMessageAuthorNameResolver,
  registerParticipantContextProvider,
  registerPreviewParticipantContextProvider,
  registerTrackerFieldSplitter,
  type BridgeTurn,
  type BridgeTurnRequest,
  type BridgeUserMessageInfo,
  type ParticipantContext,
  type ParticipantContextRequest,
  type PreviewParticipantContext,
  type PreviewParticipantContextRequest,
} from "../generation/content-hooks.js";
import {
  buildParticipantPromptEntries,
  buildParticipantSnapshot,
  compactPersonaSummary,
  formatParticipantHistoryContent,
  formatParticipantPromptBlock,
  formatParticipantsMacro,
  participantPersonaName,
  participantSnapshotPersonaName,
  participantSpeakerName,
  type ParticipantPromptEntry,
  type PersonaPromptFields,
} from "./participant-prompt-context.js";
import { createDiscordBridgeStorage } from "../storage/discord-bridge.storage.js";

/** Minimal view of the generation request's Discord bridge sub-input. */
interface BridgeGenerateInput {
  discordBridge?: {
    bindingId: string;
    discordUserId?: string | null;
    discordDisplayName?: string | null;
    discordMessageId: string;
    personaId?: string | null;
  } | null;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

let registered = false;

/** Opaque handle carried in ParticipantContext.promptBlockHandle. */
interface ParticipantPromptBlockHandle {
  activeEntry: ParticipantPromptEntry | null;
  entries: ParticipantPromptEntry[];
}

/** Idempotently register all Discord-bridge generation hooks. */
export function registerDiscordBridgeHooks(db: DB): void {
  if (registered) return;
  registered = true;

  // Prefix user history messages with persona/participant identity so the model
  // can tell multiplayer Discord speakers apart.
  registerHistoryContentTransform((content, context) => {
    if (context.role !== "user") return content;
    const extra = context.extra ?? {};
    return formatParticipantHistoryContent({
      content,
      personaSnapshot: extra.personaSnapshot,
      participantSnapshot: extra.participantSnapshot,
    });
  });

  const bridgeStorage = createDiscordBridgeStorage(db);

  // Resolve multiplayer participant context for one generation: the active
  // speaker, the {{participants}} macro, and serializable agent-context data.
  registerParticipantContextProvider(
    async (request: ParticipantContextRequest): Promise<ParticipantContext> => {
      const activeParticipant = request.activeParticipant as { id?: string } | null | undefined;
      const persona = request.persona as PersonaPromptFields | null;
      const allPersonas = request.allPersonas as PersonaPromptFields[];

      const participantRows =
        request.bridgeActive || request.chatMode === "roleplay"
          ? await bridgeStorage.listActiveParticipants(request.chatId)
          : [];
      const entries = buildParticipantPromptEntries(participantRows, allPersonas);
      const activeEntry = activeParticipant
        ? (entries.find((entry) => entry.participant.id === activeParticipant.id) ?? null)
        : null;

      const handle: ParticipantPromptBlockHandle = { activeEntry, entries };

      return {
        speakerName: participantSpeakerName(activeEntry, request.personaName),
        speakerPersona: compactPersonaSummary(activeEntry?.persona ?? persona ?? null),
        participantsMacro: formatParticipantsMacro(entries),
        agentParticipants: entries.map((entry) => ({
          participantId: entry.participant.id,
          source: entry.participant.source,
          guildId: entry.participant.guildId,
          discordUserId: entry.participant.discordUserId,
          discordDisplayName: entry.participant.discordDisplayName,
          personaId: entry.participant.personaId,
          personaName: participantPersonaName(entry),
          active: entry.participant.active,
          hasSpoken: entry.participant.hasSpoken,
          lastMessageId: entry.participant.lastMessageId,
          lastSpokeAt: entry.participant.lastSpokeAt,
        })),
        agentActiveParticipant: activeEntry
          ? buildParticipantSnapshot({ participant: activeEntry.participant, persona: activeEntry.persona })
          : null,
        promptBlockHandle: handle,
      };
    },
    (handle, wrapFormat, controlRuleOverride) => {
      const typed = handle as ParticipantPromptBlockHandle;
      return formatParticipantPromptBlock({
        activeEntry: typed.activeEntry,
        entries: typed.entries,
        wrapFormat: wrapFormat as "xml" | "markdown" | "none",
        controlRuleOverride,
      });
    },
  );

  // Read-only preview speaker resolution for dry-run / prompt-preview routes.
  registerPreviewParticipantContextProvider(
    async (request: PreviewParticipantContextRequest): Promise<PreviewParticipantContext> => {
      const persona = request.persona as PersonaPromptFields | null;
      const allPersonas = request.allPersonas as PersonaPromptFields[];
      const rows = await bridgeStorage.listActiveParticipants(request.chatId);
      const entries = buildParticipantPromptEntries(rows, allPersonas);
      const latest = latestParticipantSnapshot(request.messages);
      const activeEntry =
        entries.find((entry) => entry.participant.id === latest?.participantId) ??
        entries.find(
          (entry) =>
            typeof latest?.discordUserId === "string" && entry.participant.discordUserId === latest.discordUserId,
        ) ??
        [...entries].reverse().find((entry) => entry.participant.hasSpoken) ??
        entries[0] ??
        null;
      const handle: ParticipantPromptBlockHandle = { activeEntry, entries };
      return {
        speakerName: participantSpeakerName(activeEntry, request.personaName),
        speakerPersona: compactPersonaSummary(activeEntry?.persona ?? persona ?? null),
        participantsMacro: formatParticipantsMacro(entries),
        promptBlockHandle: handle,
      };
    },
  );

  // Per-generation bridge turn: resolve the binding + turn persona up front,
  // then upsert participant / mapping / snapshot when the user message saves.
  registerBridgeTurnFactory(async (request: BridgeTurnRequest): Promise<BridgeTurn | null> => {
    const bridgeInput = (request.input as BridgeGenerateInput).discordBridge;
    if (!bridgeInput) return null;

    const binding = await bridgeStorage.getThreadBindingById(bridgeInput.bindingId);
    if (!binding || binding.chatId !== request.chatId) {
      return {
        turnPersonaId: null,
        error: "Discord bridge binding does not match this chat",
        eventSource: "discord_bridge",
        activeParticipant: null,
        async onUserMessageSaved() {
          return {};
        },
      };
    }

    const chatRow = request.chat as { personaId?: string | null };
    const boundPersonaId = (binding.personaId as string | null) ?? (chatRow.personaId ?? null);
    let turnPersonaId: string | null;
    if (bridgeInput.discordUserId) {
      const userPersona = await bridgeStorage.getUserPersona(binding.guildId, bridgeInput.discordUserId);
      turnPersonaId = bridgeInput.personaId ?? userPersona?.personaId ?? boundPersonaId ?? null;
    } else {
      turnPersonaId = bridgeInput.personaId ?? boundPersonaId ?? null;
    }

    let activeParticipant: Awaited<ReturnType<typeof bridgeStorage.upsertDiscordParticipant>> | null = null;

    return {
      turnPersonaId,
      eventSource: "discord_bridge",
      get activeParticipant() {
        return activeParticipant;
      },
      async onUserMessageSaved(info: BridgeUserMessageInfo) {
        if (bridgeInput.discordUserId) {
          activeParticipant = await bridgeStorage.upsertDiscordParticipant({
            chatId: request.chatId,
            guildId: binding.guildId,
            discordUserId: bridgeInput.discordUserId,
            discordDisplayName:
              bridgeInput.discordDisplayName?.trim() || bridgeInput.discordUserId || "Discord User",
            personaId: turnPersonaId,
            active: true,
            hasSpoken: true,
            lastMessageId: info.userMessageId,
            lastSpokeAt: info.createdAt,
          });
        }
        await bridgeStorage.upsertMessageMapping({
          bindingId: binding.id,
          marinaraMessageId: info.userMessageId,
          discordMessageIds: [bridgeInput.discordMessageId],
          role: "user",
          direction: "discord_to_engine",
          contentHash: sha256(info.content),
        });
        const extra: Record<string, unknown> = {};
        if (activeParticipant) {
          extra.participantSnapshot = buildParticipantSnapshot({
            participant: activeParticipant,
            persona: (info.snapshotPersona as PersonaPromptFields | null) ?? null,
          });
        }
        return { extra };
      },
    };
  });

  // Resolve a stored user message's author name from its persona/participant snapshot.
  registerMessageAuthorNameResolver((extra) =>
    participantSnapshotPersonaName({
      personaSnapshot: extra?.personaSnapshot,
      participantSnapshot: extra?.participantSnapshot,
    }),
  );

  // Split the reserved "Participant Tracker" field out of the custom tracker fields.
  registerTrackerFieldSplitter((fields) => {
    const { participantTracker, customFields } = splitParticipantTrackerFields(fields as CustomTrackerField[]);
    return {
      participantTrackerText: participantTracker ? formatParticipantTrackerField(participantTracker) : null,
      customFields,
    };
  });
}

/** Parse a message `extra` blob that may be a JSON string or an object. */
function parseExtraBlob(extra: unknown): Record<string, unknown> | null {
  if (!extra) return null;
  if (typeof extra === "string") {
    try {
      return JSON.parse(extra) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return typeof extra === "object" ? (extra as Record<string, unknown>) : null;
}

/** Find the most recent message's participant snapshot, newest first. */
function latestParticipantSnapshot(messages: unknown[]): Record<string, unknown> | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const extra = parseExtraBlob((messages[index] as { extra?: unknown } | undefined)?.extra);
    const snapshot = extra?.participantSnapshot;
    if (snapshot && typeof snapshot === "object") return snapshot as Record<string, unknown>;
  }
  return undefined;
}
