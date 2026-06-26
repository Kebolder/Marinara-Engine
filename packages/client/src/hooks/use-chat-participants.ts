// ──────────────────────────────────────────────
// Discord-bridge multiplayer participant hooks
// ──────────────────────────────────────────────
//
// Split out of use-chats so the core chat hooks file stays free of bridge
// concerns and future upstream merges to use-chats don't collide here.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DiscordBridgeParticipant } from "@marinara-engine/shared";
import { api } from "../lib/api-client";
import { chatKeys } from "./use-chats";

export type ChatParticipantView = DiscordBridgeParticipant & {
  personaName: string | null;
};

export function useChatParticipants(chatId: string | null, enabled = true) {
  return useQuery({
    queryKey: chatKeys.participants(chatId ?? ""),
    queryFn: () => api.get<ChatParticipantView[]>(`/chats/${chatId}/participants`),
    enabled: !!chatId && enabled,
    staleTime: 30_000,
  });
}

export function useDeactivateChatParticipant(chatId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (participantId: string) => {
      if (!chatId) throw new Error("Chat ID is required");
      return api.delete<{ success: boolean }>(`/chats/${chatId}/participants/${participantId}`);
    },
    onSuccess: () => {
      if (chatId) qc.invalidateQueries({ queryKey: chatKeys.participants(chatId) });
    },
  });
}
