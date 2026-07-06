import type { ChatRealtimeEvent } from "@marinara-engine/shared";

type ChatEventListener = (event: ChatRealtimeEvent) => void;

const listeners = new Set<ChatEventListener>();

interface DiscordBridgeConnectionInfo {
  botTag: string | null;
  guildId: string | null;
}

const discordBridgeConnections = new Map<symbol, DiscordBridgeConnectionInfo>();

export function markDiscordBridgeConnected(info: DiscordBridgeConnectionInfo): symbol {
  const id = Symbol("discord-bridge-connection");
  discordBridgeConnections.set(id, info);
  return id;
}

export function markDiscordBridgeDisconnected(id: symbol): void {
  discordBridgeConnections.delete(id);
}

export function getDiscordBridgeConnectionStatus(): {
  connected: boolean;
  botTag: string | null;
  guildId: string | null;
} {
  const latest = [...discordBridgeConnections.values()].at(-1) ?? null;
  return {
    connected: discordBridgeConnections.size > 0,
    botTag: latest?.botTag ?? null,
    guildId: latest?.guildId ?? null,
  };
}

export function publishChatEvent(event: ChatRealtimeEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

export function subscribeChatEvents(listener: ChatEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function createChatRealtimeEvent(
  input: Omit<ChatRealtimeEvent, "timestamp"> & { timestamp?: string },
): ChatRealtimeEvent {
  return {
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}
