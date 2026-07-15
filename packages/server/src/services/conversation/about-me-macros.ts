import { resolveMacros, type MacroContext } from "@marinara-engine/shared";

export interface AboutMeMacroFields {
  description?: string;
  personality?: string;
  scenario?: string;
  backstory?: string;
  appearance?: string;
}

function stableIdentity(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed && !trimmed.includes("{{") ? trimmed : fallback;
}

/**
 * Build the identity/card macro view that an About Me draft would have in a
 * Conversation prompt. AI Write is a separate one-shot route, so its selected
 * source fields need the same expansion before they are sent to the provider.
 */
export function createAboutMeMacroResolver(args: {
  kind: "character" | "persona";
  name: string;
  source: AboutMeMacroFields;
  activePersonaName?: string;
  activePersonaFields?: AboutMeMacroFields;
}): (value: string) => string {
  const targetPersonaName = args.kind === "persona" ? stableIdentity(args.name, "") : "";
  const user = targetPersonaName || stableIdentity(args.activePersonaName, "User");
  const initialContext: MacroContext = {
    user,
    char: "Character",
    characters: [],
    variables: {},
  };
  const resolvedTargetName = resolveMacros(args.name, initialContext, { trimResult: false });
  const char = args.kind === "character" ? stableIdentity(resolvedTargetName, "Character") : "Character";
  const personaFields = args.kind === "persona" ? args.source : args.activePersonaFields;
  const context: MacroContext = {
    ...initialContext,
    char,
    characters: args.kind === "character" ? [char] : [],
    characterFields:
      args.kind === "character"
        ? {
            description: args.source.description,
            personality: args.source.personality,
            scenario: args.source.scenario,
            backstory: args.source.backstory,
            appearance: args.source.appearance,
          }
        : undefined,
    personaFields: personaFields
      ? {
          description: personaFields.description,
          personality: personaFields.personality,
          scenario: personaFields.scenario,
          backstory: personaFields.backstory,
          appearance: personaFields.appearance,
        }
      : undefined,
  };

  return (value: string) => resolveMacros(value, context, { trimResult: false });
}
