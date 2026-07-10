import assert from "node:assert/strict";
import {
  noodleGeneratedRefreshSchema,
  noodlePollInputSchema,
} from "../../packages/shared/src/schemas/noodle.schema.js";
import { createNoodlePoll, readNoodlePollFromMetadata } from "../../packages/shared/src/utils/noodle-polls.js";

const poll = createNoodlePoll({ question: "  Best pasta? ", options: [" Penne ", "Farfalle", "Gnocchi"] });
assert.ok(poll);
assert.equal(poll.question, "Best pasta?");
assert.deepEqual(
  poll.options.map((option) => option.id),
  ["option-1", "option-2", "option-3"],
);
assert.equal(readNoodlePollFromMetadata({ poll })?.options[1]?.label, "Farfalle");
assert.equal(noodlePollInputSchema.safeParse({ question: "Pick", options: ["Same", "same"] }).success, false);
assert.equal(noodlePollInputSchema.safeParse({ question: "Pick", options: ["Only one"] }).success, false);

const generated = noodleGeneratedRefreshSchema.parse({
  posts: [
    {
      tempId: "poll-1",
      authorEntityId: "character-1",
      content: "Settle this for me.",
      poll: { question: "Choose", options: ["One", "Two"] },
    },
  ],
  interactions: [
    {
      actorEntityId: "character-2",
      targetTempId: "poll-1",
      type: "vote",
      pollOptionIndex: 1,
    },
    {
      actorEntityId: "character-1",
      targetPostId: "existing-post-1",
      parentInteractionId: "persona-comment-1",
      type: "reply",
      content: "A direct answer to the persona comment.",
    },
  ],
});
assert.equal(generated.posts[0]?.poll?.options.length, 2);
assert.equal(generated.interactions[0]?.pollOptionIndex, 1);
assert.equal(generated.interactions[1]?.parentInteractionId, "persona-comment-1");

const generatedWithNullPlaceholders = noodleGeneratedRefreshSchema.parse({
  interactions: [
    {
      actorEntityId: "character-2",
      targetTempId: "poll-1",
      targetPostId: null,
      type: "like",
      content: null,
      pollOptionIndex: null,
    },
  ],
});
assert.equal(generatedWithNullPlaceholders.interactions[0]?.targetPostId, undefined);
assert.equal(generatedWithNullPlaceholders.interactions[0]?.pollOptionIndex, undefined);
assert.equal(
  noodleGeneratedRefreshSchema.safeParse({
    interactions: [{ actorEntityId: "character-2", targetPostId: "post-1", type: "vote" }],
  }).success,
  false,
);
assert.equal(
  noodleGeneratedRefreshSchema.safeParse({
    interactions: [
      {
        actorEntityId: "character-2",
        targetPostId: "post-1",
        parentInteractionId: "comment-1",
        type: "like",
      },
    ],
  }).success,
  false,
);
assert.equal(
  noodleGeneratedRefreshSchema.safeParse({
    interactions: [{ actorEntityId: "character-2", targetPostId: "post-1", type: "vote", pollOptionIndex: null }],
  }).success,
  false,
);

console.info("Noodle poll regression passed.");
