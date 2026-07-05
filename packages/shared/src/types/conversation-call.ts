import type { MessageRole } from "./chat.js";

export type ConversationCallStatus = "ringing" | "active" | "ended" | "declined" | "missed";
export type ConversationCallMode = "audio" | "video";
export type ConversationCallInitiator = "user" | "character";
export type ConversationCallParticipantKind = "user" | "character";
export type ConversationCallMessageKind = "speech" | "text" | "system" | "command" | "soundboard";
export type ConversationCallTurnMode = "voice" | "text" | "command";
export type ConversationCallAudioInputMode = "system" | "auto" | "transcribe" | "local_whisper";

export interface ConversationCallSession {
  id: string;
  chatId: string;
  status: ConversationCallStatus;
  mode: ConversationCallMode;
  initiator: ConversationCallInitiator;
  initiatorCharacterId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationCallMessage {
  id: string;
  callId: string;
  chatId: string;
  role: MessageRole;
  characterId: string | null;
  participantKind: ConversationCallParticipantKind;
  kind: ConversationCallMessageKind;
  content: string;
  extra: Record<string, unknown>;
  createdAt: string;
}

export interface ConversationCallSound {
  id: string;
  name: string;
  filePath: string | null;
  mimeType: string;
  durationMs: number | null;
  builtIn: boolean;
  createdAt: string;
}

export interface ConversationCallParticipantState {
  id: string;
  kind: ConversationCallParticipantKind;
  displayName: string;
  avatarUrl: string | null;
  characterId: string | null;
  muted: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  speaking: boolean;
  canSpeak: boolean;
}

export interface ConversationCallTurn {
  id?: string;
  speakerName: string;
  characterId?: string | null;
  mode: ConversationCallTurnMode;
  content: string;
  tone?: string | null;
}

export interface ConversationCallMessageResponse {
  userMessage: ConversationCallMessage;
  assistantMessages: ConversationCallMessage[];
  turns: ConversationCallTurn[];
  session: ConversationCallSession;
}

export interface ConversationCallIdleResponse {
  assistantMessages: ConversationCallMessage[];
  turns: ConversationCallTurn[];
  session: ConversationCallSession;
}

export interface ConversationCallStatusResponse {
  activeCall: ConversationCallSession | null;
  ringingCall: ConversationCallSession | null;
}
