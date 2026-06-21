// ──────────────────────────────────────────────
// Storage: Turn-Game Engine State Snapshots
// ──────────────────────────────────────────────
// Game-agnostic persistence for the turn-game framework (UNO and beyond).
// Mirrors game-state.storage.ts (per-message snapshots + committed flag +
// regen-exclusion) but stores an opaque engine JSON blob instead of RPG fields.
import { and, desc, eq, gt, ne } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { gameEngineState } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";

export type GameEngineStateRow = typeof gameEngineState.$inferSelect;
export type GameEngineVisibleAnchor = { messageId: string; swipeIndex: number };

export interface CreateGameEngineStateInput {
  chatId: string;
  messageId: string;
  swipeIndex: number;
  gameType: string;
  schemaVersion: number;
  /** Already JSON-stringified engine state. */
  state: string;
  committed?: boolean;
}

export function createGameEngineStateStorage(db: DB) {
  return {
    async getLatest(chatId: string) {
      const rows = await db
        .select()
        .from(gameEngineState)
        .where(eq(gameEngineState.chatId, chatId))
        .orderBy(desc(gameEngineState.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async getLatestCommitted(chatId: string) {
      const rows = await db
        .select()
        .from(gameEngineState)
        .where(and(eq(gameEngineState.chatId, chatId), eq(gameEngineState.committed, 1)))
        .orderBy(desc(gameEngineState.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async getByChatAndMessage(chatId: string, messageId: string, swipeIndex = 0) {
      const rows = await db
        .select()
        .from(gameEngineState)
        .where(
          and(
            eq(gameEngineState.chatId, chatId),
            eq(gameEngineState.messageId, messageId),
            eq(gameEngineState.swipeIndex, swipeIndex),
          ),
        )
        .orderBy(desc(gameEngineState.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async getLatestExcludingMessage(chatId: string, excludeMessageId: string) {
      const rows = await db
        .select()
        .from(gameEngineState)
        .where(and(eq(gameEngineState.chatId, chatId), ne(gameEngineState.messageId, excludeMessageId)))
        .orderBy(desc(gameEngineState.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * Resolve the state to use for a generation/turn. Prefers the snapshot tied
     * to the currently-visible message anchor (so editing/swiping rewinds the
     * game), then the latest committed, then the latest of any.
     */
    async getForGeneration(
      chatId: string,
      options?: {
        visibleAnchor?: GameEngineVisibleAnchor | null;
        excludeMessageId?: string | null;
      },
    ) {
      if (options?.visibleAnchor?.messageId) {
        const visible = await this.getByChatAndMessage(
          chatId,
          options.visibleAnchor.messageId,
          options.visibleAnchor.swipeIndex,
        );
        if (visible) return visible;
      }
      if (options?.excludeMessageId) {
        const committed = await db
          .select()
          .from(gameEngineState)
          .where(
            and(
              eq(gameEngineState.chatId, chatId),
              eq(gameEngineState.committed, 1),
              ne(gameEngineState.messageId, options.excludeMessageId),
            ),
          )
          .orderBy(desc(gameEngineState.createdAt))
          .limit(1);
        if (committed[0]) return committed[0];
        return this.getLatestExcludingMessage(chatId, options.excludeMessageId);
      }
      return (await this.getLatestCommitted(chatId)) ?? (await this.getLatest(chatId));
    },

    /** Create a snapshot, replacing any prior one for the same (message, swipe). */
    async create(input: CreateGameEngineStateInput) {
      // Dedupe unconditionally — including the empty-message live anchor
      // (messageId === ""). Otherwise repeated live-row writes (e.g. the
      // bot-turn persistence-failure fallback, which re-creates with
      // messageId "") accumulate rows for (chatId, "", swipeIndex) unbounded.
      await db
        .delete(gameEngineState)
        .where(
          and(
            eq(gameEngineState.messageId, input.messageId),
            eq(gameEngineState.swipeIndex, input.swipeIndex),
            eq(gameEngineState.chatId, input.chatId),
          ),
        );
      const id = newId();
      await db.insert(gameEngineState).values({
        id,
        chatId: input.chatId,
        messageId: input.messageId,
        swipeIndex: input.swipeIndex,
        gameType: input.gameType,
        schemaVersion: input.schemaVersion,
        state: input.state,
        committed: input.committed ? 1 : 0,
        createdAt: now(),
      });
      return id;
    },

    /** Replace the stored state (and optionally the commit flag) on an existing row. */
    async updateStateById(id: string, state: string, committed?: boolean) {
      const updates: Partial<GameEngineStateRow> = { state };
      if (committed !== undefined) updates.committed = committed ? 1 : 0;
      await db.update(gameEngineState).set(updates).where(eq(gameEngineState.id, id));
    },

    /** Re-anchor a snapshot to a (message, swipe) once the narration message exists. */
    async reanchor(id: string, messageId: string, swipeIndex: number) {
      await db.update(gameEngineState).set({ messageId, swipeIndex }).where(eq(gameEngineState.id, id));
    },

    async commit(id: string) {
      await db.update(gameEngineState).set({ committed: 1 }).where(eq(gameEngineState.id, id));
    },

    /** Mark every snapshot for a chat committed (used when a turn cycle finishes). */
    async commitForChat(chatId: string) {
      await db.update(gameEngineState).set({ committed: 1 }).where(eq(gameEngineState.chatId, chatId));
    },

    /** Drop snapshots strictly newer than a reference timestamp (rewind on regenerate/branch). */
    async deleteAfter(chatId: string, createdAtExclusive: string) {
      await db
        .delete(gameEngineState)
        .where(and(eq(gameEngineState.chatId, chatId), gt(gameEngineState.createdAt, createdAtExclusive)));
    },

    async deleteForChat(chatId: string) {
      await db.delete(gameEngineState).where(eq(gameEngineState.chatId, chatId));
    },
  };
}
