// ──────────────────────────────────────────────
// Noodle Prompt Instructions
// ──────────────────────────────────────────────
import {
  readNoodlePollFromMetadata,
  type NoodleAccountKind,
  type NoodleInteraction,
  type NoodlePost,
  type NoodleSettings,
} from "@marinara-engine/shared";

export const NOODLE_PAST_MEMORY_MIN_AGE_MS = 48 * 60 * 60 * 1000;
export const NOODLE_PAST_MEMORY_MAX_ITEMS = 3;
export const NOODLE_PAST_MEMORY_INCLUSION_CHANCE = 0.5;
export const NOODLE_PERSONA_AUTHORSHIP_INSTRUCTION =
  "- The user persona is controlled exclusively by the user. Never generate posts, replies, likes, reposts, poll votes, or follows as a persona. Personas may only be mentioned or targeted by other accounts.";
export const NOODLE_CREATIVE_FORMAT_INSTRUCTIONS = [
  "- Characters and random users may create polls in their own posts and vote in polls. Occasionally use a poll when an audience question or set of choices fits naturally with the account and current activity; polls are optional, not a quota.",
  "- Standard Unicode emojis are allowed in post and reply content. Use them naturally when they fit the account's voice or reaction; emojis are optional, and not every post or reply needs one.",
  "- Characters are allowed to be assholes to each other when it fits their personalities, history, and relationships. They may be rude, insulting, confrontational, jealous, petty, sarcastic, start arguments, revive old grievances, form rivalries, or deliberately stir up interpersonal drama. This is permission, not a quota: do not force hostility into every refresh or flatten established characterization just to create conflict.",
] as const;

type NoodleTimelineFeatureSettings = Pick<
  NoodleSettings,
  "allowRandomUsers" | "enableImagePrompts" | "allowGalleryImageAttachments"
>;

type RandomSource = () => number;
type NoodlePromptPost = Pick<
  NoodlePost,
  | "id"
  | "authorAccountId"
  | "authorSnapshot"
  | "content"
  | "imageUrl"
  | "imagePrompt"
  | "metadata"
  | "createdAt"
>;
type NoodlePromptInteraction = Pick<
  NoodleInteraction,
  | "id"
  | "postId"
  | "parentInteractionId"
  | "actorAccountId"
  | "actorSnapshot"
  | "type"
  | "content"
  | "imageUrl"
  | "createdAt"
>;

const NOODLE_PROMPT_REPLIES_PER_POST = 12;

export interface NoodlePromptImageCandidate {
  key: string;
  imageUrl: string;
  postId: string;
  interactionId: string | null;
  createdAt: string;
}

export function noodlePostImageKey(postId: string): string {
  return `noodle-post-image:${postId}`;
}

export function noodleReplyImageKey(interactionId: string): string {
  return `noodle-reply-image:${interactionId}`;
}

export function canGenerateNoodleActivityForAccountKind(kind: NoodleAccountKind): boolean {
  return kind === "character" || kind === "random_user";
}

export function noodlePersonaCommentPostIds(
  interactions: Array<Pick<NoodleInteraction, "postId" | "actorAccountId" | "type">>,
  personaAccountId?: string,
): string[] {
  if (!personaAccountId) return [];
  return Array.from(
    new Set(
      interactions
        .filter((interaction) => interaction.type === "reply" && interaction.actorAccountId === personaAccountId)
        .map((interaction) => interaction.postId),
    ),
  );
}

function promptRepliesForPost(
  interactions: NoodlePromptInteraction[],
  postId: string,
  priorityActorAccountId?: string,
) {
  const replies = interactions.filter((interaction) => interaction.postId === postId && interaction.type === "reply");
  const prioritized = priorityActorAccountId
    ? replies.filter((interaction) => interaction.actorAccountId === priorityActorAccountId).reverse()
    : [];
  const newest = replies.slice().reverse();
  const selected = new Map<string, NoodlePromptInteraction>();
  for (const reply of [...prioritized, ...newest]) {
    if (selected.size >= NOODLE_PROMPT_REPLIES_PER_POST) break;
    selected.set(reply.id, reply);
  }
  return [...selected.values()].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

export function collectNoodlePromptImageCandidates(
  posts: NoodlePromptPost[],
  interactions: NoodlePromptInteraction[],
  options: { priorityActorAccountId?: string } = {},
): NoodlePromptImageCandidate[] {
  const candidates: NoodlePromptImageCandidate[] = [];
  for (const post of posts) {
    if (post.imageUrl) {
      candidates.push({
        key: noodlePostImageKey(post.id),
        imageUrl: post.imageUrl,
        postId: post.id,
        interactionId: null,
        createdAt: post.createdAt,
      });
    }
    for (const reply of promptRepliesForPost(interactions, post.id, options.priorityActorAccountId)) {
      if (!reply.imageUrl) continue;
      candidates.push({
        key: noodleReplyImageKey(reply.id),
        imageUrl: reply.imageUrl,
        postId: post.id,
        interactionId: reply.id,
        createdAt: reply.createdAt,
      });
    }
  }
  return candidates;
}

export function formatNoodleTimelineForPrompt(
  posts: NoodlePromptPost[],
  interactions: NoodlePromptInteraction[],
  options: {
    emptyMessage?: string;
    includeTimestamp?: boolean;
    priorityActorAccountId?: string;
    attachedImageKeys?: ReadonlySet<string>;
    imageCaptions?: ReadonlyMap<string, string>;
  } = {},
) {
  if (posts.length === 0) return options.emptyMessage ?? "No recent Noodle posts.";
  return posts
    .slice()
    .reverse()
    .map((post) => {
      const author = post.authorSnapshot?.displayName ?? post.authorAccountId;
      const poll = readNoodlePollFromMetadata(post.metadata);
      const pollSummary = poll
        ? ` [poll: ${poll.question}; ${poll.options
            .map((option, index) => {
              const votes = interactions.filter(
                (interaction) =>
                  interaction.postId === post.id && interaction.type === "vote" && interaction.content === option.id,
              ).length;
              return `option ${index}: ${option.label} (${votes} vote${votes === 1 ? "" : "s"})`;
            })
            .join("; ")}]`
        : "";
      const timestamp = options.includeTimestamp ? ` at ${post.createdAt}` : "";
      const replyLines = promptRepliesForPost(interactions, post.id, options.priorityActorAccountId).map((reply) => {
        const replyAuthor = reply.actorSnapshot?.displayName ?? reply.actorAccountId;
        const replyHandle = reply.actorSnapshot?.handle ? ` (@${reply.actorSnapshot.handle})` : "";
        const parent = reply.parentInteractionId ? ` parentReplyId=${reply.parentInteractionId}` : "";
        const imageKey = noodleReplyImageKey(reply.id);
        const imageAttached = options.attachedImageKeys?.has(imageKey) === true;
        const imageCaption = options.imageCaptions?.get(imageKey)?.trim();
        const replyBody =
          reply.content || (imageAttached ? "[image]" : reply.imageUrl ? "[image reply]" : "[empty reply]");
        return `  - replyId=${reply.id}${parent} by ${replyAuthor}${replyHandle} at ${reply.createdAt}: ${replyBody}${
          imageAttached
            ? ` [attached image: ${imageKey}]`
            : imageCaption
              ? ` [image description: ${imageCaption}]`
              : reply.imageUrl && reply.content
                ? " [image not attached]"
                : ""
        }`;
      });
      const postImageKey = noodlePostImageKey(post.id);
      const postImageAttached = options.attachedImageKeys?.has(postImageKey) === true;
      const postImageCaption = options.imageCaptions?.get(postImageKey)?.trim();
      return [
        `- ${post.id} by ${author}${timestamp}: ${post.content}${pollSummary}${
          postImageAttached
            ? ` [attached image: ${postImageKey}]`
            : postImageCaption
              ? ` [image description: ${postImageCaption}]`
              : post.imagePrompt
                ? ` [image prompt: ${post.imagePrompt}]`
                : post.imageUrl
                  ? " [image not attached]"
                  : ""
        }`,
        ...replyLines,
      ].join("\n");
    })
    .join("\n");
}

function normalizedRandom(random: RandomSource): number {
  const value = random();
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.999_999, Math.max(0, value));
}

export function noodlePastMemoryCutoff(at = new Date()): string {
  return new Date(at.getTime() - NOODLE_PAST_MEMORY_MIN_AGE_MS).toISOString();
}

export function noodlePastMemorySampleSize(random: RandomSource = Math.random): number {
  if (normalizedRandom(random) >= NOODLE_PAST_MEMORY_INCLUSION_CHANCE) return 0;
  return 1 + Math.floor(normalizedRandom(random) * NOODLE_PAST_MEMORY_MAX_ITEMS);
}

export function sampleNoodlePastMemories<T>(
  items: readonly T[],
  limit: number,
  random: RandomSource = Math.random,
): T[] {
  const count = Math.min(Math.max(0, Math.floor(limit)), NOODLE_PAST_MEMORY_MAX_ITEMS, items.length);
  if (count === 0) return [];
  const pool = [...items];
  for (let index = 0; index < count; index += 1) {
    const selectedIndex = index + Math.floor(normalizedRandom(random) * (pool.length - index));
    [pool[index], pool[selectedIndex]] = [pool[selectedIndex]!, pool[index]!];
  }
  return pool.slice(0, count);
}

export function noodleTimelineFeatureInstructions(settings: NoodleTimelineFeatureSettings): string[] {
  return [
    ...(settings.allowRandomUsers
      ? [
          "- Use only the active accounts listed by entityId. Do not invent accounts.",
          "- A small minority of posts from random_user accounts may be obvious parody advertisements or absurd fake crypto scams. Usually generate none and never more than one per refresh. Keep every company, product, coin, ticker, price, and financial claim invented, visibly ridiculous, and non-actionable. Never imitate a real company or include real or usable links, wallet addresses, financial advice, or scam instructions.",
        ]
      : []),
    ...(settings.enableImagePrompts
      ? [
          "- When image generation is enabled, imagePrompt should be a concrete visual idea for the attached image: either a character-focused image of the author/their scene/selfie, or an in-character meme they would plausibly post.",
        ]
      : []),
    ...(settings.allowGalleryImageAttachments
      ? [
          "- When gallery attachments are enabled, set attachGalleryImage to true only when the post naturally fits an existing gallery or chat image.",
        ]
      : []),
  ];
}
