// ──────────────────────────────────────────────
// Importer: SillyTavern Prompt Preset
// ──────────────────────────────────────────────
import type { DB } from "../../db/connection.js";
import type { MarkerConfig } from "@marinara-engine/shared";
import { createPromptsStorage } from "../storage/prompts.storage.js";
import type { PromptVariableGroup } from "@marinara-engine/shared";
import type { TimestampOverrides } from "./import-timestamps.js";

const VALID_REASONING = new Set(["low", "medium", "high", "xhigh", "maximum"]);

/** Friendly display names for consolidated markers. */
const MARKER_DISPLAY_NAMES: Partial<Record<string, string>> = {
  character: "Character Info",
  lorebook: "World Info",
  persona: "Persona",
  chat_history: "Chat History",
  dialogue_examples: "Chat Examples",
  chat_summary: "Chat Summary",
  agent_data: "Agent Data",
};
function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
function normalizeTopP(v: number | null | undefined) {
  const clamped = clamp(v ?? 1, 0, 1);
  return clamped <= 0 ? 1 : clamped;
}
function toReasoningEffort(v: unknown): "low" | "medium" | "high" | "xhigh" | "maximum" | null {
  if (typeof v === "string" && v === "min") return "low";
  if (typeof v === "string" && v === "max") return "maximum";
  if (typeof v === "string" && v === "auto") return "maximum";
  if (typeof v === "string" && VALID_REASONING.has(v)) return v as "low" | "medium" | "high" | "xhigh" | "maximum";
  return null;
}

function toVerbosity(v: unknown): "low" | "medium" | "high" | null {
  return v === "low" || v === "medium" || v === "high" ? v : null;
}

function parseStringArray(raw: unknown, parseJsonString: boolean): string[] {
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (typeof raw !== "string") return [];
  if (!parseJsonString) return raw ? [raw] : [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  } catch {
    return [];
  }
}

function normalizeStopSequences(preset: STPreset): string[] {
  const seen = new Set<string>();
  const stops = [...parseStringArray(preset.custom_stopping_strings, true), ...parseStringArray(preset.stop, false)];
  return stops.filter((stop) => {
    if (seen.has(stop)) return false;
    seen.add(stop);
    return true;
  });
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.replace(/^(['"])(.*)\1$/, "$2");
  }
}

function parseCustomParameters(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    const out: Record<string, unknown> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf(":");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      if (!key) continue;
      out[key] = parseScalar(trimmed.slice(separator + 1));
    }
    return out;
  }
}

interface STPromptEntry {
  identifier: string;
  name: string;
  system_prompt?: boolean;
  role?: string;
  content?: string;
  marker?: boolean;
  enabled?: boolean;
  injection_position?: number;
  injection_depth?: number;
  injection_order?: number;
  forbid_overrides?: boolean;
}

interface STPreset {
  prompts?: STPromptEntry[];
  prompt_order?: Array<{
    character_id: number;
    order: Array<{ identifier: string; enabled: boolean }>;
  }>;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  openai_max_tokens?: number;
  openai_max_context?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  reasoning_effort?: string;
  squash_system_messages?: boolean;
  show_thoughts?: boolean;
  [key: string]: unknown;
}

/**
 * Import a SillyTavern prompt preset JSON.
 * Parses the prompt array, variable toggle groups, and generation parameters.
 */
export async function importSTPreset(
  raw: Record<string, unknown>,
  db: DB,
  fileName?: string,
  options?: { timestampOverrides?: TimestampOverrides | null },
) {
  const storage = createPromptsStorage(db);
  const preset = raw as unknown as STPreset;

  // Detect variable toggle groups from naming patterns
  const variableGroups = detectVariableGroups(preset.prompts ?? []);

  // Create the preset
  const created = await storage.create(
    {
      name: `Imported: ${guessPresetName(raw, fileName)}`,
      description: "Imported from SillyTavern",
      variableGroups,
      variableValues: {},
      parameters: {
        temperature: clamp(preset.temperature ?? 1, 0, 2),
        topP: normalizeTopP(preset.top_p),
        topK: Math.max(0, Math.round(preset.top_k ?? 0)),
        minP: clamp(preset.min_p ?? 0, 0, 1),
        maxTokens: Math.max(1, Math.round(preset.openai_max_tokens ?? 4096)),
        maxContext: Math.max(1, Math.round(preset.openai_max_context ?? 128000)),
        frequencyPenalty: clamp(preset.frequency_penalty ?? 0, -2, 2),
        presencePenalty: clamp(preset.presence_penalty ?? 0, -2, 2),
        reasoningEffort: toReasoningEffort(preset.reasoning_effort),
        verbosity: toVerbosity(preset.verbosity ?? preset.verbosity_level ?? preset.verbosity_levels),
        serviceTier: null,
        assistantPrefill: typeof preset.assistant_prefill === "string" ? preset.assistant_prefill : "",
        customParameters: parseCustomParameters(preset.custom_include_body),
        squashSystemMessages: preset.squash_system_messages ?? true,
        showThoughts: preset.show_thoughts ?? true,
        useMaxContext: false,
        stopSequences: normalizeStopSequences(preset),
        strictRoleFormatting: true,
        singleUserMessage: false,
      },
    },
    options?.timestampOverrides,
  );

  if (!created) return { error: "Failed to create preset" };

  // Determine the section order from prompt_order (prefer the custom 100001 ordering)
  const orderDef = preset.prompt_order?.find((o) => o.character_id === 100001) ?? preset.prompt_order?.[0];
  const orderMap = new Map(orderDef?.order?.map((o, i) => [o.identifier, { index: i, enabled: o.enabled }]) ?? []);
  const chatHistoryIndex = orderMap.get("chatHistory")?.index ?? Number.MAX_SAFE_INTEGER;

  // Import each prompt entry as a section
  const prompts = preset.prompts ?? [];
  let sectionsCreated = 0;

  // Sort prompts by prompt_order so sections are created in the correct display order.
  // Prompts not listed in prompt_order are appended at the end.
  const sortedPrompts = [...prompts].sort((a, b) => {
    const idxA = orderMap.get(a.identifier)?.index ?? Number.MAX_SAFE_INTEGER;
    const idxB = orderMap.get(b.identifier)?.index ?? Number.MAX_SAFE_INTEGER;
    return idxA - idxB;
  });

  // Detect XML wrapper bracket pairs and create groups for them
  const groupIdMap = await detectAndCreateGroups(sortedPrompts, created.id, storage);

  // Track identifier → created section ID for reordering
  const createdSectionIds: string[] = [];

  // Track which consolidated marker types have already been emitted so we
  // don't create duplicates (e.g. worldInfoBefore + worldInfoAfter → one lorebook).
  const emittedMarkerTypes = new Set<string>();

  for (const entry of sortedPrompts) {
    // Skip bracket entries that are just XML open/close tags (now handled by groups)
    const isBracket = /^[┌└┎┖⌈⌊⌜⌞]/.test(entry.name);
    if (isBracket && !entry.content?.trim()) continue;

    // Map ST marker identifiers to our marker types
    const mappedMarkerConfig = entry.marker ? mapSTMarkerConfig(entry.identifier) : null;

    // Deduplicate consolidated markers — if we already emitted a marker of
    // this type, skip the duplicate (e.g. second world-info or character marker).
    if (mappedMarkerConfig) {
      const key = mappedMarkerConfig.type;
      if (emittedMarkerTypes.has(key)) continue;
      emittedMarkerTypes.add(key);
    }

    // Map ST role to our role
    let role: "system" | "user" | "assistant" = "system";
    if (entry.role === "user") role = "user";
    if (entry.role === "assistant") role = "assistant";

    // Determine injection position
    const entryOrderIndex = orderMap.get(entry.identifier)?.index ?? Number.MAX_SAFE_INTEGER;
    const isPostHistoryEntry =
      entryOrderIndex > chatHistoryIndex &&
      /(?:jailbreak|post[_-]?history|posthistory)/i.test(`${entry.identifier} ${entry.name}`);
    if (isPostHistoryEntry) role = "user";
    const injectionPosition =
      isPostHistoryEntry || entry.injection_position === 1 ? ("depth" as const) : ("ordered" as const);

    // Check override from prompt_order
    const orderInfo = orderMap.get(entry.identifier);
    const enabled = orderInfo?.enabled ?? entry.enabled ?? true;

    // Assign to group if the entry was between bracket markers
    const groupId = isPostHistoryEntry ? null : (groupIdMap.get(entry.identifier) ?? null);

    // Use friendly names for consolidated markers
    const sectionName = mappedMarkerConfig ? (MARKER_DISPLAY_NAMES[mappedMarkerConfig.type] ?? entry.name) : entry.name;

    const section = await storage.createSection({
      presetId: created.id,
      identifier: entry.identifier,
      name: sectionName,
      content: entry.content ?? "",
      role,
      enabled,
      isMarker: !!mappedMarkerConfig,
      injectionPosition,
      injectionDepth: isPostHistoryEntry ? 0 : (entry.injection_depth ?? 0),
      injectionOrder: entry.injection_order ?? 100,
      groupId,
      markerConfig: mappedMarkerConfig,
      forbidOverrides: entry.forbid_overrides ?? false,
    });
    if (section) createdSectionIds.push(section.id);
    sectionsCreated++;
  }

  // Explicitly set the section order and injection orders to match prompt_order.
  // This ensures correct ordering regardless of createSection append behavior.
  if (createdSectionIds.length > 0) {
    await storage.reorderSections(created.id, createdSectionIds);
  }

  return {
    success: true,
    presetId: created.id,
    sectionsImported: sectionsCreated,
    variableGroups: variableGroups.length,
  };
}

/**
 * Map an ST marker identifier to the correct MarkerConfig.
 * ST uses camelCase identifiers (e.g. "chatHistory", "charDescription") but the
 * marker expander expects specific types (e.g. "chat_history", "character").
 *
 * ST splits character info into separate Description / Personality / Scenario markers
 * and world info into Before / After — we consolidate each into a single marker.
 */
function mapSTMarkerConfig(identifier: string): MarkerConfig | null {
  switch (identifier) {
    case "chatHistory":
      return { type: "chat_history" };
    case "charDescription":
    case "charPersonality":
    case "scenario":
    case "enhanceDefinitions":
      return { type: "character" };
    case "personaDescription":
      return { type: "persona" };
    case "worldInfoBefore":
    case "worldInfoAfter":
      return { type: "lorebook" };
    case "dialogueExamples":
      return { type: "dialogue_examples" };
    default:
      // For unknown markers (main, nsfw, jailbreak, etc.), return null
      // so they're treated as regular content sections
      return null;
  }
}

/**
 * Detect variable toggle groups from ST's naming convention.
 * Patterns like "➊ Game Master", "➋ Roleplayer" with {{setvar::type::value}}
 */
function detectVariableGroups(prompts: STPromptEntry[]): PromptVariableGroup[] {
  const groups = new Map<string, PromptVariableGroup>();

  // Look for setvar patterns in content
  for (const entry of prompts) {
    if (!entry.content) continue;
    const matches = entry.content.matchAll(/\{\{setvar::(\w+)::([^}]+)\}\}/gi);
    for (const match of matches) {
      const varName = match[1]!;
      const varValue = match[2]!;
      if (!groups.has(varName)) {
        groups.set(varName, {
          name: varName,
          label: varName.charAt(0).toUpperCase() + varName.slice(1),
          options: [],
        });
      }
      const group = groups.get(varName)!;
      if (!group.options.find((o) => o.value === varValue)) {
        group.options.push({ label: entry.name.replace(/^[➊➋➌➍➎➏➐➑➀➁➂➃➄➅]\s*/, ""), value: varValue });
      }
    }
  }

  return Array.from(groups.values());
}

/**
 * Detect bracket-paired XML wrappers (┌ open / └ close) and create groups.
 * Returns a map of promptIdentifier → groupId for sections inside the pair.
 */
async function detectAndCreateGroups(
  prompts: STPromptEntry[],
  presetId: string,
  storage: ReturnType<typeof createPromptsStorage>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const openStack: Array<{ name: string; startIdx: number }> = [];

  for (let i = 0; i < prompts.length; i++) {
    const entry = prompts[i]!;
    if (/^[┌┎⌈⌜]/.test(entry.name)) {
      const groupName = entry.name.replace(/^[┌┎⌈⌜]\s*/, "").trim();
      openStack.push({ name: groupName, startIdx: i });
    } else if (/^[└┖⌊⌞]/.test(entry.name) && openStack.length > 0) {
      const open = openStack.pop()!;
      // Create a group and assign all entries between open and close
      const group = await storage.createGroup({ presetId, name: open.name });
      if (group) {
        for (let j = open.startIdx + 1; j < i; j++) {
          const inner = prompts[j]!;
          map.set(inner.identifier, group.id);
        }
      }
    }
  }

  return map;
}

function guessPresetName(raw: Record<string, unknown>, fileName?: string): string {
  if (typeof raw.name === "string" && raw.name.trim()) return raw.name;
  // Try to find a Read-Me prompt with a name embedded in a comment
  const prompts = (raw.prompts ?? []) as STPromptEntry[];
  const readme = prompts.find((p) => p.name?.includes("Read-Me") || p.name?.includes("README"));
  if (readme?.content) {
    // Match {{// PresetName ... }} comment on first line
    const commentMatch = readme.content.match(/\{\{\/\/\s*([^(\n{]+)/);
    if (commentMatch) {
      const name = commentMatch[1]!.replace(/[,!]+\s*$/, "").trim();
      if (name.length > 2) return name;
    }
    // Fallback: match "name:" or "title:" or "preset:" patterns
    const nameMatch = readme.content.match(/(?:name|title|preset)[:\s]+["']?([^"'\n]+)/i);
    if (nameMatch) return nameMatch[1]!.trim();
  }
  // Use the file-derived name if provided
  if (fileName) return fileName;
  return "SillyTavern Preset";
}
