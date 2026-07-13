// ──────────────────────────────────────────────
// Registered prompt-override keys: Noodle social feed
// ──────────────────────────────────────────────
import type { PromptOverrideKeyDef } from "../types.js";

export interface NoodleImagePostCtx extends Record<string, string | number | undefined> {
  authorName: string;
  postContent: string;
  draftPrompt: string;
  userInstructions: string;
  characterDescription: string;
}

export const NOODLE_IMAGE_POST: PromptOverrideKeyDef<NoodleImagePostCtx> = {
  key: "noodle.imagePost",
  label: "Noodle Post Image",
  description: "Template that turns a generated Noodle post image idea into the final image-generation prompt.",
  variables: [
    { name: "authorName", description: "Display name of the Noodle account posting.", example: "Dottore" },
    {
      name: "postContent",
      description: "The text of the Noodle post that the image will be attached to.",
      example: "I left one meeting unattended for six minutes and returned to theatrical accusations.",
    },
    {
      name: "draftPrompt",
      description: "The timeline writer's initial image idea for this post.",
      example: 'Meme image: Dottore staring at a ruined lab bench, caption text "six minutes unsupervised" at the top',
    },
    {
      name: "userInstructions",
      description: "Noodle-specific image instructions from Noodle Settings.",
      example:
        "Create either a social-media-ready character image or a meme. Mention build, clothing, appearance, pose, expression, setting, lighting, mood, composition, meme format, and short visible meme text when relevant.",
    },
    {
      name: "characterDescription",
      description: "Optional character appearance or description notes included by Noodle Settings.",
      example: "Character appearance notes:\nDottore's Appearance: tall, slim build, blue hair, red eyes, mask.",
    },
  ],
  defaultBuilder: (ctx) =>
    [
      `Create one concise image-generation prompt for a fake social media post by ${ctx.authorName}.`,
      ``,
      `Post text: ${ctx.postContent}`,
      `Draft image idea: ${ctx.draftPrompt}`,
      ctx.userInstructions ? `User instructions: ${ctx.userInstructions}` : "",
      ctx.characterDescription || "",
      ``,
      `The image may be either a character-focused image (selfie, portrait, scene, candid, or illustration) or an in-character meme.`,
      `For character-focused images, describe the visible subject, build/body type when relevant, clothing, appearance, expression, pose, setting, lighting, mood, framing, and composition.`,
      `For memes, describe the meme format, visual gag, composition, character appearance if a character is visible, and exact short readable caption/text only when the meme needs it.`,
      `Do not include UI chrome, social-media interface elements, watermarks, or unrelated text.`,
      `Output only the final positive image prompt.`,
    ]
      .filter(Boolean)
      .join("\n"),
  exampleContext: {
    authorName: "Dottore",
    postContent: "I left one meeting unattended for six minutes and returned to theatrical accusations.",
    draftPrompt:
      'Meme image: Dottore staring at a ruined lab bench, caption text "six minutes unsupervised" at the top',
    userInstructions:
      "Create either a social-media-ready character image or a meme. Mention build, clothing, appearance, pose, expression, setting, lighting, mood, composition, meme format, and short visible meme text when relevant.",
    characterDescription:
      "Character appearance notes:\nDottore's Appearance: tall, slim build, blue hair, red eyes, mask.",
  },
};
