// ──────────────────────────────────────────────
// Generation Content Hooks
// ──────────────────────────────────────────────
//
// Generic extension points that let optional modules (e.g. the Discord bridge)
// hook into core generation without core files importing those modules. Core
// calls the generic `apply*` runners; optional modules call the matching
// `register*` at startup. Default behaviour is identity/no-op, so a build that
// never registers a hook behaves exactly as before.
//
// Keeping these seams here means upstream merges to the core route files don't
// collide with bridge-specific logic — the bridge lives entirely behind the
// registry.

import type { AgentContext } from "@marinara-engine/shared";

/** Context describing the history message whose content is being transformed. */
export interface HistoryContentContext {
  /** Message role ("user" | "assistant" | "system" | "narrator" | ...). */
  role: string;
  /** Parsed message `extra` blob, if available. */
  extra: Record<string, unknown> | null | undefined;
}

type HistoryContentTransform = (content: string, context: HistoryContentContext) => string;

const historyContentTransforms: HistoryContentTransform[] = [];

/** Register a transform applied to each history message's content before it is sent to the model. */
export function registerHistoryContentTransform(transform: HistoryContentTransform): void {
  historyContentTransforms.push(transform);
}

/** Apply all registered history-content transforms in registration order. */
export function applyHistoryContentTransforms(content: string, context: HistoryContentContext): string {
  let result = content;
  for (const transform of historyContentTransforms) {
    result = transform(result, context);
  }
  return result;
}

// ── Participant prompt context ────────────────────
//
// Multiplayer / Discord-bridge speaker and participant data that gets folded
// into the prompt. Core resolves the bundle once and reads its fields at the
// macro-context, prompt-block, and agent-context sites. The Discord-typed
// inputs/handles are passed through as `unknown` so core stays bridge-free.

/** Inputs the provider needs to resolve participant context for one generation. */
export interface ParticipantContextRequest {
  chatId: string;
  chatMode: string;
  /** Fallback speaker name (the chat persona) when no participant is active. */
  personaName: string;
  /** Resolved chat persona row, or null. */
  persona: unknown;
  /** All persona rows, used to resolve participant personas. */
  allPersonas: unknown[];
  /** The active bridge participant for this turn, if any (opaque to core). */
  activeParticipant: unknown;
  /** The request's Discord bridge input, if any (opaque to core). */
  bridgeInput: unknown;
}

/** Resolved participant context consumed at the core prompt-assembly sites. */
export interface ParticipantContext {
  /** Name the model should treat as the current speaker. */
  speakerName: string;
  /** Compact persona summary for the speaker, if any. */
  speakerPersona?: string;
  /** Rendered `{{participants}}` macro value, if any. */
  participantsMacro?: string;
  /** Serializable participant list for agent context. */
  agentParticipants: NonNullable<AgentContext["participants"]>;
  /** Serializable active-participant snapshot for agent context. */
  agentActiveParticipant: AgentContext["activeParticipant"];
  /** Opaque handle the prompt-block renderer uses once wrapFormat is known. */
  promptBlockHandle: unknown;
}

type ParticipantContextProvider = (request: ParticipantContextRequest) => Promise<ParticipantContext>;
type ParticipantPromptBlockRenderer = (handle: unknown, wrapFormat: string) => string | null;

let participantContextProvider: ParticipantContextProvider | null = null;
let participantPromptBlockRenderer: ParticipantPromptBlockRenderer | null = null;

/** Register the participant-context provider and its prompt-block renderer. */
export function registerParticipantContextProvider(
  provider: ParticipantContextProvider,
  promptBlockRenderer: ParticipantPromptBlockRenderer,
): void {
  participantContextProvider = provider;
  participantPromptBlockRenderer = promptBlockRenderer;
}

/** Resolve participant context, or a speaker-only default when no provider is registered. */
export async function resolveParticipantContext(request: ParticipantContextRequest): Promise<ParticipantContext> {
  if (!participantContextProvider) {
    return {
      speakerName: request.personaName,
      agentParticipants: [],
      agentActiveParticipant: null,
      promptBlockHandle: null,
    };
  }
  return participantContextProvider(request);
}

/** Render the participant prompt block for the given context handle and wrap format. */
export function renderParticipantPromptBlock(handle: unknown, wrapFormat: string): string | null {
  if (!participantPromptBlockRenderer || handle == null) return null;
  return participantPromptBlockRenderer(handle, wrapFormat);
}

// ── Preview participant context ───────────────────
//
// Read-only variant used by the dry-run and prompt-preview routes. There is no
// live turn, so the provider picks a representative speaker from the chat's last
// participant snapshot (falling back to the last speaker, then the first).

/** Inputs for resolving preview participant context. */
export interface PreviewParticipantContextRequest {
  chatId: string;
  chatMode: string;
  personaName: string;
  persona: unknown;
  allPersonas: unknown[];
  /** Chat messages (newest last) — the provider reads the latest participant snapshot from these. */
  messages: unknown[];
}

/** Speaker/participant macro values for a preview render. */
export interface PreviewParticipantContext {
  speakerName: string;
  speakerPersona?: string;
  participantsMacro?: string;
}

type PreviewParticipantContextProvider = (
  request: PreviewParticipantContextRequest,
) => Promise<PreviewParticipantContext>;

let previewParticipantContextProvider: PreviewParticipantContextProvider | null = null;

/** Register the preview participant-context provider. */
export function registerPreviewParticipantContextProvider(provider: PreviewParticipantContextProvider): void {
  previewParticipantContextProvider = provider;
}

/** Resolve preview participant context, or a speaker-only default when no provider is registered. */
export async function resolvePreviewParticipantContext(
  request: PreviewParticipantContextRequest,
): Promise<PreviewParticipantContext> {
  if (!previewParticipantContextProvider) {
    return { speakerName: request.personaName };
  }
  return previewParticipantContextProvider(request);
}
