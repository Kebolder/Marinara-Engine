import type { AgentPromptTemplateOption } from "../types/agent.js";

export const GAME_VIDEO_PROMPT_TEMPLATE_ID = "cinematic-scene-video";

export const GAME_VIDEO_PROMPT_TEMPLATE_VARIABLES = [
  "sceneTitle",
  "narrationSummary",
  "illustrationPrompt",
  "charactersLine",
  "settingLine",
  "artStyleLine",
  "durationSeconds",
  "aspectRatio",
  "sourceIllustrationLine",
] as const;

export const GAME_VIDEO_PROMPT_TEMPLATE = [
  "Create a ${durationSeconds}-second ${aspectRatio} animated game scene from the provided first-frame illustration.",
  "${sourceIllustrationLine}",
  "Scene: ${sceneTitle}",
  "Story beat: ${narrationSummary}",
  "Characters: ${charactersLine}",
  "Setting: ${settingLine}",
  "Art style: ${artStyleLine}",
  "Reference prompt excerpt: ${illustrationPrompt}",
  "Use the reference image as the visual anchor. Keep recognizable characters, setting, and mood while adding motion that feels natural for this moment.",
  "You may choose the most cinematic camera drift, focus shift, gestures, atmospheric movement, and ending pose that fit the scene.",
  "Avoid subtitles, captions, UI, logos, watermarks, unrelated new characters, distorted anatomy, and abrupt cuts.",
].join("\n");

export const GAME_VIDEO_BUILT_IN_PROMPT_TEMPLATES: AgentPromptTemplateOption[] = [
  {
    id: GAME_VIDEO_PROMPT_TEMPLATE_ID,
    name: "Cinematic Scene Video",
    description:
      "Default Game Mode video prompt for animating a saved scene or storyboard keyframe from its first-frame image.",
    promptTemplate: GAME_VIDEO_PROMPT_TEMPLATE,
  },
];
