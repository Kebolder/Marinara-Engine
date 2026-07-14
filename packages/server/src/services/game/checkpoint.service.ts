// ──────────────────────────────────────────────
// Service: Game Checkpoints
//
// Auto-save and manual checkpoint creation,
// listing, and loading for game mode.
// ──────────────────────────────────────────────

import { eq, desc } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { gameCheckpoints } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";

export type CheckpointTrigger =
  | "manual"
  | "session_start"
  | "session_end"
  | "combat_start"
  | "combat_end"
  | "location_change"
  | "auto_interval";

export interface CreateCheckpointInput {
  chatId: string;
  snapshotId: string;
  spatialSnapshotId?: string | null;
  messageId: string;
  label: string;
  triggerType: CheckpointTrigger;
  location?: string | null;
  gameState?: string | null;
  weather?: string | null;
  timeOfDay?: string | null;
  turnNumber?: number | null;
}

export interface CheckpointRow {
  id: string;
  chatId: string;
  snapshotId: string;
  spatialSnapshotId: string | null;
  messageId: string;
  label: string;
  triggerType: string;
  location: string | null;
  gameState: string | null;
  weather: string | null;
  timeOfDay: string | null;
  turnNumber: number | null;
  createdAt: string;
}

export function createCheckpointService(db: DB) {
  return {
    async create(input: CreateCheckpointInput): Promise<string> {
      const id = newId();
      await db.insert(gameCheckpoints).values({
        id,
        chatId: input.chatId,
        snapshotId: input.snapshotId,
        spatialSnapshotId: input.spatialSnapshotId ?? null,
        messageId: input.messageId,
        label: input.label,
        triggerType: input.triggerType,
        location: input.location ?? null,
        gameState: input.gameState ?? null,
        weather: input.weather ?? null,
        timeOfDay: input.timeOfDay ?? null,
        turnNumber: input.turnNumber ?? null,
        createdAt: now(),
      });
      return id;
    },

    async listForChat(chatId: string): Promise<CheckpointRow[]> {
      return db
        .select()
        .from(gameCheckpoints)
        .where(eq(gameCheckpoints.chatId, chatId))
        .orderBy(desc(gameCheckpoints.createdAt));
    },

    async getById(id: string): Promise<CheckpointRow | null> {
      const rows = await db.select().from(gameCheckpoints).where(eq(gameCheckpoints.id, id)).limit(1);
      return (rows[0] as CheckpointRow) ?? null;
    },

    async deleteForChat(chatId: string): Promise<void> {
      await db.delete(gameCheckpoints).where(eq(gameCheckpoints.chatId, chatId));
    },

    async deleteById(id: string): Promise<void> {
      await db.delete(gameCheckpoints).where(eq(gameCheckpoints.id, id));
    },
  };
}
