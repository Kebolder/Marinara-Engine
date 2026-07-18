export type ReviewedImagePromptSubmission = {
  prompt: string;
  negativePrompt: string;
};

/**
 * Apply a reviewed positive prompt while retaining the compiled negative prompt
 * unless the review payload explicitly supplies a replacement, including an
 * empty string that intentionally clears it.
 */
export function resolveReviewedImagePromptSubmission(args: {
  generatedPrompt: string;
  generatedNegativePrompt: string;
  promptOverride?: string;
  negativePromptOverride?: string;
}): ReviewedImagePromptSubmission {
  const promptOverride = args.promptOverride?.trim();
  const negativePrompt =
    promptOverride && args.negativePromptOverride !== undefined
      ? args.negativePromptOverride.trim()
      : args.generatedNegativePrompt;
  return {
    prompt: promptOverride || args.generatedPrompt,
    negativePrompt,
  };
}
