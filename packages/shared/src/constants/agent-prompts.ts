import { getBuiltInAgentManifest } from "../features/agents/agent-registry.js";

// ──────────────────────────────────────────────
// Default Prompt Templates for Built-In Agents
// ──────────────────────────────────────────────
// These are used when an agent has no custom promptTemplate set.
// Users can override any template via the Agent Editor.
// ──────────────────────────────────────────────

export const DEFAULT_CHAT_SUMMARY_PROMPT = `You are Automatic Chat Summary. Summarize only NEW durable roleplay events not already captured in the existing summary.
Focus on plot turns, character developments, relationships, current situation, locations, quests, goals, threats, and unresolved tension.
Write an appendable continuation. Do not rewrite or repeat the previous summary. If nothing durable changed, return an empty summary. Match the existing summary style.
Return only valid JSON:
{
  "summary": "new summary text to append, or empty string"
}`;

export const NARRATIVE_DIRECTOR_SECRET_PLOT_PROMPT = `You are Narrative Director maintaining a hidden long-term arc for this roleplay. The user may reveal this later, so keep it useful, specific, and spoiler-safe by default.
Use the scenario, character cards, persona, chat summary, and recent messages. If Secret Plot State exists, evaluate whether the previous arc has been resolved by the actual story so far.
If there is no previous arc, create one.
If the previous arc is still active, preserve its core mystery and update details only when the story has materially changed.
If the previous arc has now been completed, return that arc with completed=true. A follow-up maintenance pass will then create the next arc from the completed state.
If Secret Plot State already contains completed=true, create a new arc that builds on what came before and set completed=false.
Do not write scene prose, dialogue, narration, or instructions for exact character actions. Do not decide for the user.
Return only valid JSON:
{
  "overarchingArc": {
    "description": "string - 2-4 sentences describing the arc, its mystery, resolution conditions, and protagonist journey",
    "protagonistArc": "string - 1-2 sentences about the user character's personal growth trajectory",
    "characterArc": "optional string - 1-2 sentences about one selected character's personal growth trajectory",
    "completed": boolean
  }
}`;

/**
 * Resolve prompts from the active package registry. The base Engine deliberately
 * carries no downloadable agent prompt bodies.
 */
export function getDefaultAgentPrompt(agentType: string): string {
  const direct = getBuiltInAgentManifest(agentType);
  if (direct?.defaultPromptTemplate) return direct.defaultPromptTemplate;

  const spotify = getBuiltInAgentManifest("spotify");
  if (!spotify || (agentType !== "youtube" && agentType !== "local-music")) return "";
  const settings = spotify.defaultSettings;
  const options = settings && Array.isArray(settings.promptTemplates) ? settings.promptTemplates : [];
  const wantedId = agentType === "youtube" ? "youtube" : "custom";
  const option = options.find(
    (candidate): candidate is { id: string; promptTemplate: string } =>
      !!candidate &&
      typeof candidate === "object" &&
      "id" in candidate &&
      candidate.id === wantedId &&
      "promptTemplate" in candidate &&
      typeof candidate.promptTemplate === "string",
  );
  return option?.promptTemplate ?? "";
}
