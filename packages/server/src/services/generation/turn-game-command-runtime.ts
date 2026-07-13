import type { FastifyReply } from "fastify";

import { pokerEngine } from "@marinara-engine/shared";

import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { getEnabledConversationSchedules } from "./conversation-context-utils.js";
import { getCurrentStatus, type WeekSchedule } from "../conversation/schedule.service.js";
import { runTurnGameBotTurns } from "../turn-games/turn-game-bot-runner.service.js";
import { getActiveTurnGame, startTurnGame } from "../turn-games/turn-game-runner.service.js";

export async function handleTurnGameCommand(args: {
  commandType: string;
  characterId: string | null;
  chatId: string;
  chatMeta: Record<string, unknown>;
  db: DB;
  chats: { getById(id: string): Promise<{ characterIds?: unknown } | null> };
  conn: unknown;
  baseUrl: string;
  reply: FastifyReply;
  signal: AbortSignal;
}): Promise<boolean> {
  if (args.commandType === "uno") {
    await startUnoFromCommand(args);
    return true;
  }
  if (args.commandType === "chess") {
    await startChessFromCommand(args);
    return true;
  }
  if (args.commandType === "poker") {
    await startPokerFromCommand(args);
    return true;
  }
  if (args.commandType === "eightball") {
    await startEightballFromCommand(args);
    return true;
  }
  if (args.commandType === "tic_tac_toe") {
    await startTicTacToeFromCommand(args);
    return true;
  }
  if (args.commandType === "rock_paper_scissors") {
    await startRockPaperScissorsFromCommand(args);
    return true;
  }
  return false;
}

async function startUnoFromCommand(args: Parameters<typeof handleTurnGameCommand>[0]): Promise<void> {
  try {
    const existingGame = await getActiveTurnGame(args.db, args.chatId);
    if (existingGame) {
      logger.info("[commands] UNO requested but a game is already active in chat %s", args.chatId);
      return;
    }

    const unoChat = await args.chats.getById(args.chatId);
    let unoCharIds: string[] = [];
    try {
      const rawCharIds = unoChat?.characterIds;
      const parsedCharIds = typeof rawCharIds === "string" ? JSON.parse(rawCharIds) : rawCharIds;
      if (Array.isArray(parsedCharIds)) {
        unoCharIds = parsedCharIds.filter((value): value is string => typeof value === "string");
      }
    } catch {
      unoCharIds = [];
    }

    const unoSchedules = getEnabledConversationSchedules(args.chatMeta) as Record<string, WeekSchedule>;
    const seatBotIds = unoCharIds.filter((cid) => {
      const sched = unoSchedules[cid];
      return !sched || getCurrentStatus(sched).status !== "offline";
    });
    if (args.characterId && unoCharIds.includes(args.characterId) && !seatBotIds.includes(args.characterId)) {
      seatBotIds.push(args.characterId);
    }

    const outcome = await startTurnGame(args.db, args.chatId, {
      gameType: "uno",
      botCharacterIds: seatBotIds,
      humanFirst: true,
    });
    if (outcome.ok) {
      args.reply.raw.write(`data: ${JSON.stringify({ type: "turn_game_state_patch", data: outcome.view })}\n\n`);
      logger.info("[commands] UNO started in chat %s with %d player(s)", args.chatId, seatBotIds.length + 1);
      await runTurnGameBotTurns({
        db: args.db,
        chatId: args.chatId,
        conn: args.conn,
        baseUrl: args.baseUrl,
        reply: args.reply,
        signal: args.signal,
      });
    } else {
      logger.warn("[commands] UNO start failed in chat %s: %s", args.chatId, outcome.error ?? "");
    }
  } catch (err) {
    logger.error(err, "[commands] UNO start failed");
  }
}

async function startChessFromCommand(args: Parameters<typeof handleTurnGameCommand>[0]): Promise<void> {
  try {
    const existingGame = await getActiveTurnGame(args.db, args.chatId);
    if (existingGame) {
      logger.info("[commands] chess requested but a game is already active in chat %s", args.chatId);
      return;
    }
    if (!args.characterId) {
      logger.warn("[commands] chess requested without an agreeing character in chat %s", args.chatId);
      return;
    }

    const outcome = await startTurnGame(args.db, args.chatId, {
      gameType: "chess",
      botCharacterIds: [args.characterId],
      humanFirst: true,
    });
    if (outcome.ok) {
      args.reply.raw.write(`data: ${JSON.stringify({ type: "turn_game_state_patch", data: outcome.view })}\n\n`);
      logger.info("[commands] chess started in chat %s against %s", args.chatId, args.characterId);
      await runTurnGameBotTurns({
        db: args.db,
        chatId: args.chatId,
        conn: args.conn,
        baseUrl: args.baseUrl,
        reply: args.reply,
        signal: args.signal,
      });
    } else {
      logger.warn("[commands] chess start failed in chat %s: %s", args.chatId, outcome.error ?? "");
    }
  } catch (err) {
    logger.error(err, "[commands] chess start failed");
  }
}

async function startPokerFromCommand(args: Parameters<typeof handleTurnGameCommand>[0]): Promise<void> {
  try {
    const existingGame = await getActiveTurnGame(args.db, args.chatId);
    if (existingGame) {
      logger.info("[commands] poker requested but a game is already active in chat %s", args.chatId);
      return;
    }

    const pokerChat = await args.chats.getById(args.chatId);
    let pokerCharIds: string[] = [];
    try {
      const rawCharIds = pokerChat?.characterIds;
      const parsedCharIds = typeof rawCharIds === "string" ? JSON.parse(rawCharIds) : rawCharIds;
      if (Array.isArray(parsedCharIds)) {
        pokerCharIds = parsedCharIds.filter((value): value is string => typeof value === "string");
      }
    } catch {
      pokerCharIds = [];
    }

    const pokerSchedules = getEnabledConversationSchedules(args.chatMeta) as Record<string, WeekSchedule>;
    const seatBotIds = pokerCharIds.filter((cid) => {
      const sched = pokerSchedules[cid];
      return !sched || getCurrentStatus(sched).status !== "offline";
    });
    if (args.characterId && pokerCharIds.includes(args.characterId) && !seatBotIds.includes(args.characterId)) {
      seatBotIds.push(args.characterId);
    }

    // Poker seats at most pokerEngine.maxPlayers total (human + bots). If more
    // willing characters exist than fit, trim the extras — keeping the agreeing
    // character first so the character that just said yes always gets a seat.
    const maxBotSeats = Math.max(0, pokerEngine.maxPlayers - 1);
    let seatedBotIds = seatBotIds;
    if (seatBotIds.length > maxBotSeats) {
      const ordered = args.characterId
        ? [args.characterId, ...seatBotIds.filter((id) => id !== args.characterId)]
        : seatBotIds;
      seatedBotIds = ordered.slice(0, maxBotSeats);
    }

    const outcome = await startTurnGame(args.db, args.chatId, {
      gameType: "poker",
      botCharacterIds: seatedBotIds,
      humanFirst: true,
    });
    if (outcome.ok) {
      args.reply.raw.write(`data: ${JSON.stringify({ type: "turn_game_state_patch", data: outcome.view })}\n\n`);
      logger.info("[commands] poker started in chat %s with %d player(s)", args.chatId, seatedBotIds.length + 1);
      await runTurnGameBotTurns({
        db: args.db,
        chatId: args.chatId,
        conn: args.conn,
        baseUrl: args.baseUrl,
        reply: args.reply,
        signal: args.signal,
      });
    } else {
      logger.warn("[commands] poker start failed in chat %s: %s", args.chatId, outcome.error ?? "");
    }
  } catch (err) {
    logger.error(err, "[commands] poker start failed");
  }
}

async function startEightballFromCommand(args: Parameters<typeof handleTurnGameCommand>[0]): Promise<void> {
  try {
    const existingGame = await getActiveTurnGame(args.db, args.chatId);
    if (existingGame) {
      logger.info("[commands] eightball requested but a game is already active in chat %s", args.chatId);
      return;
    }
    if (!args.characterId) {
      logger.warn("[commands] eightball requested without an agreeing character in chat %s", args.chatId);
      return;
    }

    const outcome = await startTurnGame(args.db, args.chatId, {
      gameType: "eightball",
      botCharacterIds: [args.characterId],
      humanFirst: true,
    });
    if (outcome.ok) {
      args.reply.raw.write(`data: ${JSON.stringify({ type: "turn_game_state_patch", data: outcome.view })}\n\n`);
      logger.info("[commands] eightball started in chat %s against %s", args.chatId, args.characterId);
      await runTurnGameBotTurns({
        db: args.db,
        chatId: args.chatId,
        conn: args.conn,
        baseUrl: args.baseUrl,
        reply: args.reply,
        signal: args.signal,
      });
    } else {
      logger.warn("[commands] eightball start failed in chat %s: %s", args.chatId, outcome.error ?? "");
    }
  } catch (err) {
    logger.error(err, "[commands] eightball start failed");
  }
}

async function startTicTacToeFromCommand(args: Parameters<typeof handleTurnGameCommand>[0]): Promise<void> {
  try {
    const existingGame = await getActiveTurnGame(args.db, args.chatId);
    if (existingGame) {
      logger.info("[commands] tic-tac-toe requested but a game is already active in chat %s", args.chatId);
      return;
    }
    if (!args.characterId) {
      logger.warn("[commands] tic-tac-toe requested without an agreeing character in chat %s", args.chatId);
      return;
    }

    const outcome = await startTurnGame(args.db, args.chatId, {
      gameType: "tic-tac-toe",
      botCharacterIds: [args.characterId],
      humanFirst: true,
    });
    if (outcome.ok) {
      args.reply.raw.write(`data: ${JSON.stringify({ type: "turn_game_state_patch", data: outcome.view })}\n\n`);
      logger.info("[commands] tic-tac-toe started in chat %s against %s", args.chatId, args.characterId);
      await runTurnGameBotTurns({
        db: args.db,
        chatId: args.chatId,
        conn: args.conn,
        baseUrl: args.baseUrl,
        reply: args.reply,
        signal: args.signal,
      });
    } else {
      logger.warn("[commands] tic-tac-toe start failed in chat %s: %s", args.chatId, outcome.error ?? "");
    }
  } catch (err) {
    logger.error(err, "[commands] tic-tac-toe start failed");
  }
}

async function startRockPaperScissorsFromCommand(args: Parameters<typeof handleTurnGameCommand>[0]): Promise<void> {
  try {
    const existingGame = await getActiveTurnGame(args.db, args.chatId);
    if (existingGame) {
      logger.info("[commands] rock-paper-scissors requested but a game is already active in chat %s", args.chatId);
      return;
    }
    if (!args.characterId) {
      logger.warn("[commands] rock-paper-scissors requested without an agreeing character in chat %s", args.chatId);
      return;
    }

    const outcome = await startTurnGame(args.db, args.chatId, {
      gameType: "rock-paper-scissors",
      botCharacterIds: [args.characterId],
      humanFirst: true,
    });
    if (outcome.ok) {
      args.reply.raw.write(`data: ${JSON.stringify({ type: "turn_game_state_patch", data: outcome.view })}\n\n`);
      logger.info("[commands] rock-paper-scissors started in chat %s against %s", args.chatId, args.characterId);
      await runTurnGameBotTurns({
        db: args.db,
        chatId: args.chatId,
        conn: args.conn,
        baseUrl: args.baseUrl,
        reply: args.reply,
        signal: args.signal,
      });
    } else {
      logger.warn("[commands] rock-paper-scissors start failed in chat %s: %s", args.chatId, outcome.error ?? "");
    }
  } catch (err) {
    logger.error(err, "[commands] rock-paper-scissors start failed");
  }
}
