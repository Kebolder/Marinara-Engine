// ──────────────────────────────────────────────
// Discord Bridge — Generation Hook Registration
// ──────────────────────────────────────────────
//
// Wires the Discord bridge's prompt/message behaviour into core generation via
// the generic registry in services/generation/content-hooks. This file is the
// single seam where bridge logic attaches to core; core files never import the
// bridge directly. Imported for its side effects at server startup (see
// discord-bridge.routes.ts).

import { registerHistoryContentTransform } from "../generation/content-hooks.js";
import { formatParticipantHistoryContent } from "./participant-prompt-context.js";

let registered = false;

/** Idempotently register all Discord-bridge generation hooks. */
export function registerDiscordBridgeHooks(): void {
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
}
