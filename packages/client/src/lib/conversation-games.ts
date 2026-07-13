import { useChessGameStore } from "../stores/chess-game.store";
import { useEightBallGameStore } from "../stores/eightball-game.store";
import { usePokerGameStore } from "../stores/poker-game.store";
import { useUnoGameStore } from "../stores/uno-game.store";
import { useTicTacToeGameStore } from "../stores/tic-tac-toe-game.store";
import { useRockPaperScissorsGameStore } from "../stores/rock-paper-scissors-game.store";

export interface ConversationGameLauncher {
  id: string;
  name: string;
  command: string;
  description: string;
  playerLabel: string;
  openSetup: (chatId: string) => void;
}

export const CONVERSATION_GAMES: ConversationGameLauncher[] = [
  {
    id: "uno",
    name: "UNO",
    command: "/uno",
    description: "Play a card match with chat characters as bot players.",
    playerLabel: "Group card game",
    openSetup: (chatId) => useUnoGameStore.getState().openSetup(chatId),
  },
  {
    id: "chess",
    name: "Chess",
    command: "/chess",
    description: "Start a one-on-one chess game against a character.",
    playerLabel: "1v1 strategy",
    openSetup: (chatId) => useChessGameStore.getState().openSetup(chatId),
  },
  {
    id: "poker",
    name: "Texas Hold'em Poker",
    command: "/poker",
    description: "Deal a poker table with the characters in this chat.",
    playerLabel: "Table game",
    openSetup: (chatId) => usePokerGameStore.getState().openSetup(chatId),
  },
  {
    id: "8ball",
    name: "8-Ball Pool",
    command: "/8ball",
    description: "Play a pool match with a character in this chat.",
    playerLabel: "1v1 table sport",
    openSetup: (chatId) => useEightBallGameStore.getState().openSetup(chatId),
  },
  {
    id: "tictactoe",
    name: "Tic-Tac-Toe",
    command: "/tictactoe",
    description: "Play a classic three-in-a-row match against a character.",
    playerLabel: "1v1 strategy",
    openSetup: (chatId) => useTicTacToeGameStore.getState().openSetup(chatId),
  },
  {
    id: "rps",
    name: "Rock Paper Scissors",
    command: "/rps",
    description: "Challenge a character to a quick rock-paper-scissors match.",
    playerLabel: "1v1 quick game",
    openSetup: (chatId) => useRockPaperScissorsGameStore.getState().openSetup(chatId),
  },
];

export function findConversationGame(query: string): ConversationGameLauncher | null {
  const normalized = query.trim().toLowerCase().replace(/^\//, "");
  if (!normalized) return null;
  return (
    CONVERSATION_GAMES.find((game) => game.id === normalized || game.command.slice(1) === normalized) ??
    CONVERSATION_GAMES.find((game) => game.name.toLowerCase() === normalized) ??
    null
  );
}
