// ──────────────────────────────────────────────
// Chat Participants Routes (Discord bridge)
// ──────────────────────────────────────────────
//
// Multiplayer Discord-bridge participant management for a chat. Registered
// under the same /api/chats prefix as the core chat routes but kept in its own
// plugin so the core chats router stays free of bridge storage concerns and
// future upstream merges don't collide here.

import type { FastifyInstance } from "fastify";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createDiscordBridgeStorage } from "../services/storage/discord-bridge.storage.js";

export async function chatParticipantsRoutes(app: FastifyInstance) {
  const storage = createChatsStorage(app.db);
  const discordBridgeStorage = createDiscordBridgeStorage(app.db);

  // List active Discord bridge participants for this chat.
  app.get<{ Params: { id: string } }>("/:id/participants", async (req, reply) => {
    const chat = await storage.getById(req.params.id);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });

    const [participants, personas] = await Promise.all([
      discordBridgeStorage.listActiveParticipants(req.params.id),
      createCharactersStorage(app.db).listPersonas(),
    ]);
    const personaNames = new Map(personas.map((persona) => [persona.id, persona.name]));

    return participants.map((participant) => ({
      ...participant,
      personaName: participant.personaId ? (personaNames.get(participant.personaId) ?? null) : null,
    }));
  });

  // Deactivate a stale Discord bridge participant without deleting history.
  app.delete<{ Params: { id: string; participantId: string } }>(
    "/:id/participants/:participantId",
    async (req, reply) => {
      const chat = await storage.getById(req.params.id);
      if (!chat) return reply.status(404).send({ error: "Chat not found" });

      const participants = await discordBridgeStorage.listActiveParticipants(req.params.id);
      if (!participants.some((participant) => participant.id === req.params.participantId)) {
        return reply.status(404).send({ error: "Participant not found" });
      }

      await discordBridgeStorage.deactivateParticipant(req.params.participantId);
      return { success: true };
    },
  );
}
