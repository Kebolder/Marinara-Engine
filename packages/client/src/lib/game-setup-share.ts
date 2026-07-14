import {
  ANIME_GAME_PROMPT_TEMPLATE_ID,
  COMIC_PAGE_GAME_VIDEO_PROMPT_TEMPLATE_ID,
  GAME_STORYBOARD_COMIC_ANIMATION_PROMPT_TEMPLATE_ID,
  STORYBOARD_OPTIMIZED_IMAGE_PROMPT_TEMPLATE_ID,
  type GameInitialSetupConnectionSnapshot,
  type GameSetupConfig,
  type GenerationParameters,
} from "@marinara-engine/shared";

export interface GameSetupShareLabels {
  characterNames?: Readonly<Record<string, string>>;
  connectionNames?: Readonly<Record<string, string>>;
  lorebookNames?: Readonly<Record<string, string>>;
  promptPresetNames?: Readonly<Record<string, string>>;
  personaName?: string | null;
}

export interface GameSetupShareSource {
  gameName: string;
  config: GameSetupConfig;
  effectiveGenerationParameters?: Partial<GenerationParameters> | null;
  preferences?: string | null;
  connections?: {
    gm?: GameInitialSetupConnectionSnapshot | null;
    scene?: GameInitialSetupConnectionSnapshot | null;
    image?: GameInitialSetupConnectionSnapshot | null;
    video?: GameInitialSetupConnectionSnapshot | null;
  };
  fallbackGmConnectionId?: string | null;
  labels?: GameSetupShareLabels;
}

export interface GameSetupSummaryRow {
  label: string;
  value: string;
}

export interface GameSetupSummarySection {
  title: string;
  rows: GameSetupSummaryRow[];
}

function titleCaseToken(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function formatValue(value: unknown): string {
  if (value == null) return "None";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "string") return value.trim() || "None";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "None";
  if (Array.isArray(value)) return value.map(formatValue).join(", ") || "None";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatNamedSelection(
  id: string | null | undefined,
  labels: Readonly<Record<string, string>> | undefined,
  fallback: string,
): string {
  if (!id) return fallback;
  return labels?.[id]?.trim() || "Selected locally (name unavailable)";
}

function formatConnectionSnapshot(snapshot: GameInitialSetupConnectionSnapshot | null | undefined): string | null {
  if (!snapshot?.name?.trim()) return null;
  const identifiers = [snapshot.model, snapshot.service]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  const provider = snapshot.provider?.trim() ? titleCaseToken(snapshot.provider.trim()) : null;
  return [snapshot.name.trim(), ...new Set(identifiers), provider].filter(Boolean).join(" · ");
}

function formatConnection(
  snapshot: GameInitialSetupConnectionSnapshot | null | undefined,
  fallbackId: string | null | undefined,
  labels: Readonly<Record<string, string>> | undefined,
  fallback: string,
): string {
  return formatConnectionSnapshot(snapshot) ?? formatNamedSelection(fallbackId, labels, fallback);
}

function formatMusicSource(config: GameSetupConfig): string {
  if (!config.enableSpotifyDj) return "Off";
  if (config.spotifySourceType === "playlist") {
    return config.spotifyPlaylistName?.trim() || "Selected Spotify playlist";
  }
  if (config.spotifySourceType === "artist") return config.spotifyArtist?.trim() || "Selected Spotify artist";
  if (config.spotifySourceType === "any") return "Any Spotify music";
  return "Liked Spotify songs";
}

function formatWidgets(config: GameSetupConfig): string {
  const widgets = config.customHudWidgets ?? [];
  if (widgets.length > 0) {
    return widgets
      .map((widget) =>
        [
          `${widget.label} (${titleCaseToken(widget.type)})`,
          formatValue({
            position: widget.position,
            icon: widget.icon,
            accent: widget.accent,
            config: widget.config,
          }),
        ].join("\n"),
      )
      .join("\n\n");
  }
  return config.enableCustomWidgets === false ? "Off" : "Designed automatically during setup";
}

function formatPresentation(config: GameSetupConfig): string {
  const selectedIds = [
    config.gameGmPromptTemplateId,
    config.gameStoryboardAnimationPromptTemplateId,
    config.gameStoryboardImagePromptTemplateId,
    config.gameStoryboardVideoPromptTemplateId,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (selectedIds.length === 0) return "Standard";
  if (
    config.gameGmPromptTemplateId === ANIME_GAME_PROMPT_TEMPLATE_ID &&
    config.gameStoryboardAnimationPromptTemplateId === GAME_STORYBOARD_COMIC_ANIMATION_PROMPT_TEMPLATE_ID &&
    (!config.gameStoryboardImagePromptTemplateId ||
      config.gameStoryboardImagePromptTemplateId === STORYBOARD_OPTIMIZED_IMAGE_PROMPT_TEMPLATE_ID) &&
    config.gameStoryboardVideoPromptTemplateId === COMIC_PAGE_GAME_VIDEO_PROMPT_TEMPLATE_ID
  ) {
    return "Storyboard Optimized";
  }
  return `Custom (${selectedIds.map(titleCaseToken).join(" + ")})`;
}

function generationParameterRows(parameters: Partial<GenerationParameters> | null | undefined): GameSetupSummaryRow[] {
  const entries = Object.entries(parameters ?? {}).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return [{ label: "Generation parameters", value: "Connection defaults (not captured)" }];
  return entries.map(([key, value]) => ({ label: titleCaseToken(key), value: formatValue(value) }));
}

export function buildGameSetupSummarySections(source: GameSetupShareSource): GameSetupSummarySection[] {
  const { config, preferences, labels, connections } = source;
  const party = config.partyCharacterIds.length
    ? config.partyCharacterIds
        .map((id) => labels?.characterNames?.[id]?.trim())
        .filter((name): name is string => !!name)
        .join(", ") || `${config.partyCharacterIds.length} locally selected characters`
    : "No starting party members";
  const gmCharacter =
    config.gmMode === "character"
      ? formatNamedSelection(config.gmCharacterId, labels?.characterNames, "Selected character")
      : "Standalone narrator";
  const lorebooks = config.activeLorebookIds?.length
    ? config.activeLorebookIds
        .map((id) => labels?.lorebookNames?.[id]?.trim())
        .filter((name): name is string => !!name)
        .join(", ") || `${config.activeLorebookIds.length} locally selected lorebooks`
    : "None";

  return [
    {
      title: "Adventure",
      rows: [
        { label: "Genre", value: config.genre },
        { label: "Setting", value: config.setting },
        { label: "Tone", value: config.tone },
        { label: "Difficulty", value: titleCaseToken(config.difficulty) },
        { label: "Combat style", value: titleCaseToken(config.combatStyle ?? "classic") },
        { label: "Content rating", value: config.rating.toUpperCase() },
        { label: "Language", value: config.language?.trim() || "Default" },
        { label: "Player goals", value: config.playerGoals.trim() || "None" },
        { label: "Additional preferences", value: preferences?.trim() || "None" },
      ],
    },
    {
      title: "Cast",
      rows: [
        { label: "Game master", value: gmCharacter },
        { label: "Player persona", value: labels?.personaName?.trim() || "None" },
        { label: "Starting party", value: party },
      ],
    },
    {
      title: "Models and prompts",
      rows: [
        {
          label: "GM / party connection",
          value: formatConnection(connections?.gm, source.fallbackGmConnectionId, labels?.connectionNames, "Default"),
        },
        {
          label: "Scene effects connection",
          value: formatConnection(
            connections?.scene,
            config.sceneConnectionId,
            labels?.connectionNames,
            "Skip / local fallback",
          ),
        },
        {
          label: "Prompt preset",
          value: formatNamedSelection(config.promptPresetId, labels?.promptPresetNames, "Default"),
        },
        { label: "Presentation", value: formatPresentation(config) },
        { label: "Custom GM prompt", value: config.gameSystemPrompt?.trim() || "Built-in default" },
        { label: "Special instructions", value: config.gameSpecialInstructions?.trim() || "None" },
      ],
    },
    {
      title: "Generation parameters",
      rows: generationParameterRows(source.effectiveGenerationParameters ?? config.generationParameters),
    },
    {
      title: "Visuals and storyboards",
      rows: [
        { label: "Visual generation", value: config.enableSpriteGeneration ? "On" : "Off" },
        {
          label: "Image connection",
          value: formatConnection(connections?.image, config.imageConnectionId, labels?.connectionNames, "None"),
        },
        {
          label: "Image style profile",
          value: config.imageStyleProfileId ? "Selected locally (name unavailable)" : "Default",
        },
        { label: "Art style prompt", value: config.artStylePrompt?.trim() || "Generated during setup" },
        {
          label: "Automatic storyboard illustrations",
          value: config.gameStoryboardAutoIllustrationsEnabled ? "On" : "Off",
        },
        { label: "Automatic storyboard animations", value: config.gameStoryboardAutoGenerationEnabled ? "On" : "Off" },
        { label: "Keyframes per turn", value: formatValue(config.gameStoryboardKeyframeCount ?? 3) },
        {
          label: "Video connection",
          value: formatConnection(connections?.video, config.videoConnectionId, labels?.connectionNames, "None"),
        },
        {
          label: "Storyboard director",
          value: config.gameStoryboardAnimationPromptTemplateId
            ? titleCaseToken(config.gameStoryboardAnimationPromptTemplateId)
            : "Built-in default",
        },
        {
          label: "Storyboard video prompt",
          value: config.gameStoryboardVideoPromptTemplateId
            ? titleCaseToken(config.gameStoryboardVideoPromptTemplateId)
            : "Built-in default",
        },
        { label: "Direct scene prompts", value: config.gameStoryboardUseDirectScenePrompt ? "On" : "Off" },
      ],
    },
    {
      title: "World tools",
      rows: [
        { label: "Active lorebooks", value: lorebooks },
        { label: "HUD widgets", value: formatWidgets(config) },
        { label: "Music DJ", value: formatMusicSource(config) },
        { label: "Lorebook Keeper", value: config.enableLorebookKeeper ? "On" : "Off" },
      ],
    },
  ];
}

export function formatGameSetupShareText(source: GameSetupShareSource): string {
  const sections = buildGameSetupSummarySections(source);
  return [
    `${source.gameName} - Marinara Game Mode Setup`,
    "Recreate this from Game > New Game. Local characters, personas, lorebooks, and connections are named but not included.",
    "",
    ...sections.flatMap((section) => [section.title, ...section.rows.map((row) => `${row.label}: ${row.value}`), ""]),
  ]
    .join("\n")
    .trim();
}
