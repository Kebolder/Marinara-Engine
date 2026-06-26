// ──────────────────────────────────────────────
// Discord Bridge — Generation Hook Registration
// ──────────────────────────────────────────────
//
// Wires the Discord bridge's prompt/message behaviour into core generation via
// the generic registry in services/generation/content-hooks. This file is the
// single seam where bridge logic attaches to core; core files never import the
// bridge directly. Invoked once at server startup (see discord-bridge.routes.ts)
// with the app db so per-request providers can read bridge storage.

import type { DB } from "../../db/connection.js";
import {
  registerHistoryContentTransform,
  registerParticipantContextProvider,
  registerPreviewParticipantContextProvider,
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
  participantSpeakerName,
  type ParticipantPromptEntry,
  type PersonaPromptFields,
} from "./participant-prompt-context.js";
import { createDiscordBridgeStorage } from "../storage/discord-bridge.storage.js";

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
      const bridgeInput = request.bridgeInput as { discordUserId?: string | null } | null | undefined;
      const activeParticipant = request.activeParticipant as { id?: string } | null | undefined;
      const persona = request.persona as PersonaPromptFields | null;
      const allPersonas = request.allPersonas as PersonaPromptFields[];

      const participantRows =
        bridgeInput || request.chatMode === "roleplay" ? await bridgeStorage.listActiveParticipants(request.chatId) : [];
      const entries = buildParticipantPromptEntries(participantRows, allPersonas);
      const activeEntry =
        activeParticipant || bridgeInput?.discordUserId
          ? (entries.find((entry) => entry.participant.id === activeParticipant?.id) ??
            entries.find(
              (entry) => entry.participant.discordUserId && entry.participant.discordUserId === bridgeInput?.discordUserId,
            ) ??
            null)
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
    (handle, wrapFormat) => {
      const typed = handle as ParticipantPromptBlockHandle;
      return formatParticipantPromptBlock({
        activeEntry: typed.activeEntry,
        entries: typed.entries,
        wrapFormat: wrapFormat as "xml" | "markdown" | "none",
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
      return {
        speakerName: participantSpeakerName(activeEntry, request.personaName),
        speakerPersona: compactPersonaSummary(activeEntry?.persona ?? persona ?? null),
        participantsMacro: formatParticipantsMacro(entries),
      };
    },
  );
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
