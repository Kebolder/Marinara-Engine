import type { ConversationCallCharacterVideoClipKind } from "@marinara-engine/shared";
import type { PromptOverrideKeyDef } from "../types.js";

export interface ConversationCallVideoClipCtx extends Record<string, string | number | undefined> {
  characterName: string;
  clipLabel: string;
  clipInstruction: string;
  durationSeconds: number;
  aspectRatio: string;
}

type ClipPromptSeed = {
  kind: ConversationCallCharacterVideoClipKind;
  label: string;
  instruction: string;
};

const CLIP_PROMPT_SEEDS: ClipPromptSeed[] = [
  {
    kind: "idle",
    label: "idle loop",
    instruction:
      "Begin from neutral idle, keep the character facing the phone/camera, add subtle breathing, blinking, and tiny natural head movement, then settle fully back into the same neutral idle pose by the final frame.",
  },
  {
    kind: "talking",
    label: "talking loop",
    instruction:
      "Begin from neutral idle, make the character speak naturally with subtle mouth and face movement, then settle fully back into neutral idle by the final frame so Marinara can return to idle cleanly when audio stops.",
  },
  {
    kind: "laughing",
    label: "laughing reaction",
    instruction:
      "Begin from neutral idle, laugh softly with natural face and shoulder movement, then settle fully back into neutral idle by the final frame.",
  },
  {
    kind: "angry",
    label: "angry reaction",
    instruction:
      "Begin from neutral idle, show anger or irritation in the face and posture, then settle fully back into neutral idle by the final frame.",
  },
  {
    kind: "crying",
    label: "crying reaction",
    instruction:
      "Begin from neutral idle, show a restrained tearful or crying reaction, then settle fully back into neutral idle by the final frame.",
  },
  {
    kind: "sighing",
    label: "sighing reaction",
    instruction:
      "Begin from neutral idle, sigh with a small breath and head movement, then settle fully back into neutral idle by the final frame.",
  },
];

function buildDefaultPrompt(ctx: ConversationCallVideoClipCtx) {
  return [
    `Create a ${ctx.durationSeconds}-second ${ctx.aspectRatio} ${ctx.clipLabel} for an AI character in a private video call.`,
    `Character name: ${ctx.characterName}.`,
    ctx.clipInstruction,
    "Use the supplied avatar as the exact identity and art style reference.",
    "Keep camera framing stable like a video-call participant tile. Preserve the avatar's face, hair, outfit cues, and art style.",
    "Single character only. No extra people. No UI, captions, subtitles, speech bubbles, text, logos, or watermarks.",
  ].join("\n");
}

function makeConversationCallVideoPrompt(seed: ClipPromptSeed): PromptOverrideKeyDef<ConversationCallVideoClipCtx> {
  return {
    key: `conversation.callVideo.${seed.kind}`,
    description: `Conversation Call character video prompt for the ${seed.label} clip.`,
    variables: [
      { name: "characterName", description: "Character display name.", example: "Dottore" },
      { name: "clipLabel", description: "Human-readable clip type.", example: seed.label },
      {
        name: "clipInstruction",
        description: "Clip-specific animation direction.",
        example: seed.instruction,
      },
      { name: "durationSeconds", description: "Requested clip duration in seconds.", example: "4" },
      { name: "aspectRatio", description: "Requested video aspect ratio.", example: "16:9" },
    ],
    defaultBuilder: buildDefaultPrompt,
    exampleContext: {
      characterName: "Dottore",
      clipLabel: seed.label,
      clipInstruction: seed.instruction,
      durationSeconds: seed.kind === "idle" || seed.kind === "talking" ? 5 : 4,
      aspectRatio: "16:9",
    },
  };
}

export const CONVERSATION_CALL_VIDEO_PROMPTS = CLIP_PROMPT_SEEDS.map(makeConversationCallVideoPrompt);

export const CONVERSATION_CALL_VIDEO_PROMPT_BY_KIND = new Map(
  CLIP_PROMPT_SEEDS.map((seed, index) => [seed.kind, CONVERSATION_CALL_VIDEO_PROMPTS[index]!]),
);

export const CONVERSATION_CALL_VIDEO_CLIP_INSTRUCTION_BY_KIND = new Map(
  CLIP_PROMPT_SEEDS.map((seed) => [seed.kind, seed.instruction]),
);

export const CONVERSATION_CALL_VIDEO_CLIP_LABEL_BY_KIND = new Map(
  CLIP_PROMPT_SEEDS.map((seed) => [seed.kind, seed.label]),
);
