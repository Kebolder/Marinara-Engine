import {
  noodleGeneratedDigestSchema,
  noodleGeneratedFollowSchema,
  noodleGeneratedInteractionSchema,
  noodleGeneratedPostSchema,
  noodleGeneratedRefreshSchema,
  type NoodleGeneratedRefresh,
} from "@marinara-engine/shared";

type RefreshCollection = keyof NoodleGeneratedRefresh;

export type RejectedNoodleGeneratedRefreshItem = {
  collection: RefreshCollection;
  index: number;
  issueCount: number;
};

/**
 * Require a refresh to contain usable activity attributed to the exact cast
 * selected for this run. The persona may be a follow target, but generations
 * must never author posts or interactions on the user's behalf.
 */
export function validateNoodleGeneratedRefresh(
  refresh: NoodleGeneratedRefresh,
  allowedActorEntityIds: ReadonlySet<string>,
  knownEntityIds: ReadonlySet<string>,
): string | null {
  const hasActivity =
    refresh.posts.length + refresh.interactions.length + refresh.follows.length + refresh.digests.length > 0;
  if (!hasActivity) return "the response contained no timeline activity";

  const hasUsableAttribution =
    refresh.posts.some((post) => allowedActorEntityIds.has(post.authorEntityId)) ||
    refresh.interactions.some((interaction) => allowedActorEntityIds.has(interaction.actorEntityId)) ||
    refresh.follows.some(
      (follow) => allowedActorEntityIds.has(follow.actorEntityId) && knownEntityIds.has(follow.targetEntityId),
    );
  return hasUsableAttribution ? null : "the response used no selected participant entityId";
}

const collectionSchemas = {
  posts: noodleGeneratedPostSchema,
  interactions: noodleGeneratedInteractionSchema,
  follows: noodleGeneratedFollowSchema,
  digests: noodleGeneratedDigestSchema,
} as const;

/**
 * Validate generated timeline rows independently. LLM output is untrusted and a
 * single malformed interaction must not discard otherwise valid activity.
 */
export function parseNoodleGeneratedRefresh(value: unknown): {
  refresh: NoodleGeneratedRefresh;
  rejected: RejectedNoodleGeneratedRefreshItem[];
} {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!record) {
    noodleGeneratedRefreshSchema.parse(value);
    return { refresh: { posts: [], interactions: [], follows: [], digests: [] }, rejected: [] };
  }

  const refresh: NoodleGeneratedRefresh = { posts: [], interactions: [], follows: [], digests: [] };
  const rejected: RejectedNoodleGeneratedRefreshItem[] = [];

  for (const collection of Object.keys(collectionSchemas) as RefreshCollection[]) {
    const rows = record[collection];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) {
      rejected.push({ collection, index: -1, issueCount: 1 });
      continue;
    }
    rows.forEach((row, index) => {
      const parsed = collectionSchemas[collection].safeParse(row);
      if (parsed.success) {
        // Each schema is tied to its collection; the indexed assignment keeps
        // that relationship while avoiding four duplicate parsing loops.
        (refresh[collection] as Array<typeof parsed.data>).push(parsed.data);
      } else {
        rejected.push({ collection, index, issueCount: parsed.error.issues.length });
      }
    });
  }

  return { refresh, rejected };
}
