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
