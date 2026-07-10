import assert from "node:assert/strict";
import { noodleRefreshSchema } from "../../packages/shared/src/schemas/noodle.schema.js";
import { canManageNoodleReply } from "../../packages/shared/src/utils/noodle-interactions.js";
import {
  canGenerateNoodleActivityForAccountKind,
  formatNoodleTimelineForPrompt,
  noodlePastMemoryCutoff,
  noodlePastMemorySampleSize,
  noodlePersonaCommentPostIds,
  NOODLE_CREATIVE_FORMAT_INSTRUCTIONS,
  NOODLE_PERSONA_AUTHORSHIP_INSTRUCTION,
  noodleTimelineFeatureInstructions,
  sampleNoodlePastMemories,
} from "../../packages/server/src/services/noodle/noodle-prompt.js";

assert.equal(canGenerateNoodleActivityForAccountKind("persona"), false);
assert.equal(canGenerateNoodleActivityForAccountKind("character"), true);
assert.equal(canGenerateNoodleActivityForAccountKind("random_user"), true);
assert.equal(
  noodleRefreshSchema.parse({ reviewImagePromptsBeforeSend: true }).reviewImagePromptsBeforeSend,
  true,
);
assert.match(NOODLE_PERSONA_AUTHORSHIP_INSTRUCTION, /controlled exclusively by the user/u);
assert.match(
  NOODLE_PERSONA_AUTHORSHIP_INSTRUCTION,
  /Never generate posts, replies, likes, reposts, poll votes, or follows/u,
);
assert.equal(NOODLE_CREATIVE_FORMAT_INSTRUCTIONS.length, 2);
assert.match(NOODLE_CREATIVE_FORMAT_INSTRUCTIONS[0], /create polls in their own posts and vote in polls/u);
assert.match(NOODLE_CREATIVE_FORMAT_INSTRUCTIONS[0], /polls are optional, not a quota/u);
assert.match(NOODLE_CREATIVE_FORMAT_INSTRUCTIONS[1], /Standard Unicode emojis are allowed in post and reply content/u);
assert.match(NOODLE_CREATIVE_FORMAT_INSTRUCTIONS[1], /not every post or reply needs one/u);

assert.equal(
  canManageNoodleReply({
    actorKind: "persona",
    actorAccountId: "persona-account",
    personaAccountId: "persona-account",
  }),
  true,
);
assert.equal(
  canManageNoodleReply({
    actorKind: "persona",
    actorAccountId: "other-persona-account",
    personaAccountId: "persona-account",
  }),
  false,
);
assert.equal(
  canManageNoodleReply({
    actorKind: "character",
    actorAccountId: "character-account",
    personaAccountId: "persona-account",
  }),
  true,
);
assert.equal(
  canManageNoodleReply({
    actorKind: "random_user",
    actorAccountId: "random-account",
    personaAccountId: "persona-account",
  }),
  false,
);

const threadedTimeline = formatNoodleTimelineForPrompt(
  [
    {
      id: "post-1",
      authorAccountId: "character-account",
      authorSnapshot: {
        id: "character-account",
        kind: "character",
        entityId: "character-1",
        handle: "character_one",
        displayName: "Character One",
        avatarUrl: null,
      },
      content: "A character post.",
      imagePrompt: null,
      metadata: {},
      createdAt: "2026-07-10T10:00:00.000Z",
    },
  ],
  [
    {
      id: "persona-comment-1",
      postId: "post-1",
      parentInteractionId: null,
      actorAccountId: "persona-account",
      actorSnapshot: {
        id: "persona-account",
        kind: "persona",
        entityId: "persona-1",
        handle: "smarinara_spaghetti",
        displayName: "Mari",
        avatarUrl: null,
      },
      type: "reply",
      content: "Mari asks a follow-up question.",
      imageUrl: null,
      createdAt: "2026-07-10T10:05:00.000Z",
    },
  ],
  { priorityActorAccountId: "persona-account" },
);
assert.match(threadedTimeline, /replyId=persona-comment-1/u);
assert.match(threadedTimeline, /@smarinara_spaghetti/u);
assert.match(threadedTimeline, /Mari asks a follow-up question/u);
assert.deepEqual(
  noodlePersonaCommentPostIds(
    [
      { postId: "old-post-with-new-comment", actorAccountId: "persona-account", type: "reply" },
      { postId: "other-post", actorAccountId: "character-account", type: "reply" },
      { postId: "old-post-with-new-comment", actorAccountId: "persona-account", type: "reply" },
    ],
    "persona-account",
  ),
  ["old-post-with-new-comment"],
);

const activeAccountsInstruction = "- Use only the active accounts listed by entityId. Do not invent accounts.";
const randomUserParodyInstruction =
  "- A small minority of posts from random_user accounts may be obvious parody advertisements or absurd fake crypto scams. Usually generate none and never more than one per refresh. Keep every company, product, coin, ticker, price, and financial claim invented, visibly ridiculous, and non-actionable. Never imitate a real company or include real or usable links, wallet addresses, financial advice, or scam instructions.";
const imageGenerationInstruction =
  "- When image generation is enabled, imagePrompt should be a concrete visual idea for the attached image: either a character-focused image of the author/their scene/selfie, or an in-character meme they would plausibly post.";
const galleryAttachmentInstruction =
  "- When gallery attachments are enabled, set attachGalleryImage to true only when the post naturally fits an existing gallery or chat image.";

const instructions = (input: {
  allowRandomUsers?: boolean;
  enableImagePrompts?: boolean;
  allowGalleryImageAttachments?: boolean;
}) =>
  noodleTimelineFeatureInstructions({
    allowRandomUsers: input.allowRandomUsers ?? false,
    enableImagePrompts: input.enableImagePrompts ?? false,
    allowGalleryImageAttachments: input.allowGalleryImageAttachments ?? false,
  });

assert.deepEqual(instructions({}), []);
assert.deepEqual(instructions({ allowRandomUsers: true }), [activeAccountsInstruction, randomUserParodyInstruction]);
assert.deepEqual(instructions({ enableImagePrompts: true }), [imageGenerationInstruction]);
assert.deepEqual(instructions({ allowGalleryImageAttachments: true }), [galleryAttachmentInstruction]);
assert.deepEqual(
  instructions({ allowRandomUsers: true, enableImagePrompts: true, allowGalleryImageAttachments: true }),
  [activeAccountsInstruction, randomUserParodyInstruction, imageGenerationInstruction, galleryAttachmentInstruction],
);

const cutoffAnchor = new Date("2026-07-10T12:00:00.000Z");
assert.equal(noodlePastMemoryCutoff(cutoffAnchor), "2026-07-08T12:00:00.000Z");
assert.equal(
  noodlePastMemorySampleSize(() => 0.5),
  0,
);
const oneItemRolls = [0.49, 0];
assert.equal(
  noodlePastMemorySampleSize(() => oneItemRolls.shift() ?? 0),
  1,
);
const threeItemRolls = [0, 0.999];
assert.equal(
  noodlePastMemorySampleSize(() => threeItemRolls.shift() ?? 0),
  3,
);

assert.deepEqual(
  sampleNoodlePastMemories(["a", "b", "c"], 1, () => 0.99),
  ["c"],
);
const threeMemories = sampleNoodlePastMemories(["a", "b", "c", "d"], 3, () => 0);
assert.equal(threeMemories.length, 3);
assert.equal(new Set(threeMemories).size, 3);
assert.ok(threeMemories.every((item) => ["a", "b", "c", "d"].includes(item)));
assert.deepEqual(
  sampleNoodlePastMemories(["only"], 3, () => 0),
  ["only"],
);
assert.deepEqual(
  sampleNoodlePastMemories(["a", "b", "c", "d"], 99, () => 0),
  ["a", "b", "c"],
);

console.info("Noodle prompt and memory regression passed.");
