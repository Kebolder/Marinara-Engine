import type { StorageGateway } from "../capabilities/storage";
import type { AgentResult } from "../contracts/types/agent";
import type {
  CharacterStat,
  CustomTrackerField,
  GameState,
  InventoryItem,
  PlayerStats,
  PresentCharacter,
  QuestProgress,
  RPGAttributes,
} from "../contracts/types/game-state";
import { preserveTrackerCharacterUiFields } from "./generate-route-utils";
import {
  boolish,
  isRecord,
  nowIso,
  parseRecord,
  readNonNegativeInteger,
  readNumber,
  readString,
} from "./runtime-records";

export interface TrackerSnapshotTurnTarget {
  messageId: string;
  swipeIndex: number;
}

export interface TrackerSnapshotSelectionOptions {
  preferLatestVisible?: boolean;
  visibleAnchor?: TrackerSnapshotTurnTarget | null;
  excludeMessageId?: string | null;
  fallbackTargets?: TrackerSnapshotTurnTarget[] | null;
}

export interface TrackerSnapshotReadContext {
  rows: Array<Record<string, unknown>>;
}

export interface TrackerSnapshotMessageRebase {
  sourceMessageId: string;
  targetMessageId: string;
  role?: unknown;
  activeSwipeIndex?: unknown;
  swipeCount?: unknown;
}

type TrackerStatePatch = Partial<
  Pick<
    GameState,
    | "date"
    | "time"
    | "location"
    | "weather"
    | "temperature"
    | "presentCharacters"
    | "recentEvents"
    | "playerStats"
    | "personaStats"
  >
>;

type QuestObjective = QuestProgress["objectives"][number];
type QuestUpdateAction = "create" | "update" | "complete" | "fail";
type RpgAttributeKey = keyof RPGAttributes;

const RPG_ATTRIBUTE_KEYS: RpgAttributeKey[] = ["str", "dex", "con", "int", "wis", "cha"];

interface NormalizedQuestUpdate {
  action: QuestUpdateAction;
  questName: string;
  objectives?: QuestObjective[];
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const text = value.trim();
    return text.length ? text : null;
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

function parseStat(value: unknown): CharacterStat | null {
  const record = parseRecord(value);
  const name = readString(record.name).trim();
  if (!name) return null;
  const max = Math.max(1, readNumber(record.max, 100));
  const valueNumber = Math.min(max, Math.max(0, readNumber(record.value, max)));
  const color = readString(record.color).trim() || "#8b5cf6";
  return { name, value: valueNumber, max, color };
}

function parseInventoryItem(value: unknown): InventoryItem | null {
  const record = parseRecord(value);
  const name = readString(record.name).trim();
  if (!name) return null;
  return {
    name,
    description: readString(record.description).trim(),
    quantity: Math.max(0, readNumber(record.quantity, 1)),
    location: readString(record.location).trim() || "on_person",
  };
}

function parseQuestObjective(value: unknown): { text: string; completed: boolean } | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? { text, completed: false } : null;
  }
  const record = parseRecord(value);
  const text = firstString(record.text, record.description, record.objective, record.name, record.title);
  if (!text) return null;
  const status = readString(record.status ?? record.done)
    .trim()
    .toLowerCase();
  return {
    text,
    completed: boolish(record.completed, status === "complete" || status === "completed" || status === "done"),
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = readString(value).trim();
    if (text) return text;
  }
  return undefined;
}

function parseQuest(value: unknown): QuestProgress | null {
  const record = parseRecord(value);
  const name = readString(record.name).trim() || readString(record.questName).trim();
  if (!name) return null;
  const questEntryId = readString(record.questEntryId).trim() || name;
  const objectives = Array.isArray(record.objectives)
    ? record.objectives
        .map(parseQuestObjective)
        .filter((objective): objective is { text: string; completed: boolean } => !!objective)
    : [];
  return {
    questEntryId,
    name,
    currentStage: Math.max(0, readNonNegativeInteger(record.currentStage, 0)),
    objectives,
    completed: boolish(record.completed, false),
  };
}

function parseCustomTrackerField(value: unknown): CustomTrackerField | null {
  const record = parseRecord(value);
  const name = readString(record.name).trim();
  if (!name) return null;
  return { name, value: readString(record.value).trim() };
}

function parseRpgAttributes(value: unknown): RPGAttributes | null {
  const record = parseRecord(value);
  if (!RPG_ATTRIBUTE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(record, key))) return null;
  return {
    str: readNumber(record.str, 10),
    dex: readNumber(record.dex, 10),
    con: readNumber(record.con, 10),
    int: readNumber(record.int, 10),
    wis: readNumber(record.wis, 10),
    cha: readNumber(record.cha, 10),
  };
}

function parseSkills(value: unknown): Record<string, number> {
  const record = parseRecord(value);
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, skillValue]) => [key.trim(), readNumber(skillValue, Number.NaN)] as const)
      .filter(([key, skillValue]) => key.length > 0 && Number.isFinite(skillValue)),
  );
}

function parseManualOverrides(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const overrides = Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => entry[0].trim().length > 0 && typeof entry[1] === "string")
      .map(([key, overrideValue]) => [key.trim(), overrideValue]),
  );
  return Object.keys(overrides).length ? overrides : null;
}

function parsePresentCharacter(value: unknown): PresentCharacter | null {
  const record = parseRecord(value);
  const name = readString(record.name).trim();
  const characterId = readString(record.characterId).trim() || name;
  if (!name || !characterId) return null;
  const customFields = isRecord(record.customFields)
    ? Object.fromEntries(
        Object.entries(record.customFields)
          .map(([key, fieldValue]) => [key, readString(fieldValue).trim()])
          .filter(([key]) => key.length > 0),
      )
    : {};
  return {
    characterId,
    name,
    emoji: readString(record.emoji).trim() || "*",
    mood: readString(record.mood).trim() || "neutral",
    appearance: readNullableString(record.appearance),
    outfit: readNullableString(record.outfit),
    avatarPath: readNullableString(record.avatarPath),
    portraitFocusX:
      typeof record.portraitFocusX === "number" && Number.isFinite(record.portraitFocusX)
        ? record.portraitFocusX
        : undefined,
    portraitFocusY:
      typeof record.portraitFocusY === "number" && Number.isFinite(record.portraitFocusY)
        ? record.portraitFocusY
        : undefined,
    portraitZoom:
      typeof record.portraitZoom === "number" && Number.isFinite(record.portraitZoom) ? record.portraitZoom : undefined,
    customFields,
    stats: Array.isArray(record.stats)
      ? record.stats.map(parseStat).filter((stat): stat is CharacterStat => !!stat)
      : [],
    thoughts: readNullableString(record.thoughts),
  };
}

function clonePlayerStats(value: unknown): PlayerStats {
  const record = parseRecord(value);
  return {
    stats: Array.isArray(record.stats)
      ? record.stats.map(parseStat).filter((stat): stat is CharacterStat => !!stat)
      : [],
    attributes: parseRpgAttributes(record.attributes),
    skills: parseSkills(record.skills),
    inventory: Array.isArray(record.inventory)
      ? record.inventory.map(parseInventoryItem).filter((item): item is InventoryItem => !!item)
      : [],
    activeQuests: Array.isArray(record.activeQuests)
      ? record.activeQuests.map(parseQuest).filter((quest): quest is QuestProgress => !!quest)
      : [],
    customTrackerFields: Array.isArray(record.customTrackerFields)
      ? record.customTrackerFields.map(parseCustomTrackerField).filter((field): field is CustomTrackerField => !!field)
      : undefined,
    status: readString(record.status),
  };
}

function normalizeQuestAction(value: unknown): QuestUpdateAction | null {
  const normalized = readString(value).trim().toLowerCase();
  if (normalized === "completed") return "complete";
  if (normalized === "failed") return "fail";
  return normalized === "create" || normalized === "update" || normalized === "complete" || normalized === "fail"
    ? normalized
    : null;
}

function collectQuestObjectives(value: unknown, depth = 0): QuestObjective[] {
  if (value == null || depth > 5) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => collectQuestObjectives(entry, depth + 1));
  const direct = parseQuestObjective(value);
  if (direct) return [direct];
  const record = parseRecord(value);
  if (!Object.keys(record).length) return [];
  for (const key of ["objectives", "tasks", "steps", "items", "subtasks", "children", "goals"]) {
    if (record[key] === undefined) continue;
    const nested = collectQuestObjectives(record[key], depth + 1);
    if (nested.length) return nested;
  }
  return Object.values(record).flatMap((entry) => collectQuestObjectives(entry, depth + 1));
}

function normalizeQuestUpdate(value: unknown): NormalizedQuestUpdate | null {
  const record = parseRecord(value);
  const action = normalizeQuestAction(record.action);
  const questName = firstString(record.questName, record.name, record.title, record.questEntryId);
  if (!action || !questName) return null;
  const objectives = record.objectives === undefined ? undefined : collectQuestObjectives(record.objectives);
  return {
    action,
    questName,
    ...(objectives !== undefined ? { objectives } : {}),
  };
}

function cloneQuest(quest: QuestProgress): QuestProgress {
  return {
    ...quest,
    objectives: quest.objectives.map((objective) => ({ ...objective })),
  };
}

function applyQuestUpdatesToPlayerStats(
  value: unknown,
  updatesValue: unknown,
): { playerStats: PlayerStats; changed: boolean } {
  const updates = Array.isArray(updatesValue)
    ? updatesValue.map(normalizeQuestUpdate).filter((update): update is NormalizedQuestUpdate => !!update)
    : [];
  const playerStats = clonePlayerStats(value);
  const rawActiveQuestsJson = JSON.stringify(playerStats.activeQuests);
  const quests = playerStats.activeQuests.map(cloneQuest);

  for (const update of updates) {
    let index = quests.findIndex((quest) => quest.questEntryId === update.questName);
    if (index === -1) {
      index = quests.findIndex((quest) => quest.name === update.questName);
    }
    if (update.action === "create" && index === -1) {
      quests.push({
        questEntryId: update.questName,
        name: update.questName,
        currentStage: 0,
        objectives: update.objectives ?? [],
        completed: false,
      });
    } else if (index !== -1) {
      if (update.action === "update") {
        if (update.objectives !== undefined) quests[index]!.objectives = update.objectives;
      } else if (update.action === "complete") {
        quests[index]!.completed = true;
        if (update.objectives !== undefined) quests[index]!.objectives = update.objectives;
      } else if (update.action === "fail") {
        quests.splice(index, 1);
      }
    }
  }

  for (let index = quests.length - 1; index >= 0; index -= 1) {
    const quest = quests[index]!;
    if (
      quest.completed &&
      (quest.objectives.length === 0 || quest.objectives.every((objective) => objective.completed))
    ) {
      quests.splice(index, 1);
    }
  }

  playerStats.activeQuests = quests;
  return { playerStats, changed: JSON.stringify(quests) !== rawActiveQuestsJson };
}

function normalizeGameState(value: unknown, chatId: string, target: TrackerSnapshotTurnTarget): GameState {
  const record = parseRecord(value);
  return {
    id: readString(record.id),
    chatId,
    messageId: target.messageId,
    swipeIndex: target.swipeIndex,
    date: readNullableString(record.date),
    time: readNullableString(record.time),
    location: readNullableString(record.location),
    weather: readNullableString(record.weather),
    temperature: readNullableString(record.temperature),
    presentCharacters: Array.isArray(record.presentCharacters)
      ? record.presentCharacters
          .map(parsePresentCharacter)
          .filter((character): character is PresentCharacter => !!character)
      : [],
    recentEvents: Array.isArray(record.recentEvents)
      ? record.recentEvents.map(readNullableString).filter((event): event is string => !!event)
      : [],
    playerStats: isRecord(record.playerStats) ? clonePlayerStats(record.playerStats) : null,
    personaStats: Array.isArray(record.personaStats)
      ? record.personaStats.map(parseStat).filter((stat): stat is CharacterStat => !!stat)
      : null,
    committed: record.committed === undefined ? undefined : boolish(record.committed, false),
    manualOverrides: parseManualOverrides(record.manualOverrides),
    createdAt: readString(record.createdAt) || nowIso(),
  };
}

function trackerSnapshotTargetFromRecord(value: unknown): TrackerSnapshotTurnTarget | null {
  const record = parseRecord(value);
  if (!Object.prototype.hasOwnProperty.call(record, "messageId") || typeof record.messageId !== "string") return null;
  const messageId = record.messageId.trim();
  return {
    messageId,
    swipeIndex: readNonNegativeInteger(record.swipeIndex, 0),
  };
}

export function trackerSnapshotTargetFromMessage(message: unknown): TrackerSnapshotTurnTarget | null {
  const record = parseRecord(message);
  const messageId = readString(record.id).trim();
  if (!messageId) return null;
  const fallbackSwipeIndex = Math.max(0, readNonNegativeInteger(record.swipeCount, 1) - 1);
  return {
    messageId,
    swipeIndex: readNonNegativeInteger(record.activeSwipeIndex, fallbackSwipeIndex),
  };
}

function trackerSnapshotTargetFromRebasedMessage(
  message: TrackerSnapshotMessageRebase,
): TrackerSnapshotTurnTarget | null {
  const messageId = readString(message.targetMessageId).trim();
  if (message.role !== "assistant" || !messageId) return null;
  const fallbackSwipeIndex = Math.max(0, readNonNegativeInteger(message.swipeCount, 1) - 1);
  return {
    messageId,
    swipeIndex: readNonNegativeInteger(message.activeSwipeIndex, fallbackSwipeIndex),
  };
}

function trackerTargetKey(target: TrackerSnapshotTurnTarget): string {
  return `${target.messageId}\u0000${target.swipeIndex}`;
}

export function resolveVisibleGameStateFallbackMessageIds(
  messages: Array<{ role?: unknown; id?: unknown; activeSwipeIndex?: unknown; swipeIndex?: unknown }>,
): TrackerSnapshotTurnTarget[] {
  const targets = new Map<string, TrackerSnapshotTurnTarget>();
  const addTarget = (target: TrackerSnapshotTurnTarget) => targets.set(trackerTargetKey(target), target);
  addTarget({ messageId: "", swipeIndex: 0 });
  for (const message of messages) {
    if (message.role === "assistant" && typeof message.id === "string" && message.id.trim()) {
      addTarget({
        messageId: message.id.trim(),
        swipeIndex: readNonNegativeInteger(message.activeSwipeIndex ?? message.swipeIndex, 0),
      });
    }
  }
  return Array.from(targets.values());
}

async function listTrackerSnapshotRows(
  storage: StorageGateway,
  chatId: string,
): Promise<Array<Record<string, unknown>>> {
  const rows = await storage.list<Record<string, unknown>>("game-state-snapshots", {
    filters: { chatId, kind: "tracker" },
    orderBy: "createdAt",
    descending: true,
  });
  return rows.map(parseRecord).filter((row) => trackerSnapshotTargetFromRecord(row));
}

export async function createTrackerSnapshotReadContext(
  storage: StorageGateway,
  chatId: string,
): Promise<TrackerSnapshotReadContext> {
  return { rows: await listTrackerSnapshotRows(storage, chatId) };
}

function normalizeTrackerSnapshotRow(row: Record<string, unknown>, chatId: string): GameState | null {
  const target = trackerSnapshotTargetFromRecord(row);
  return target ? normalizeGameState(row, chatId, target) : null;
}

function targetMatches(row: Record<string, unknown>, target: TrackerSnapshotTurnTarget): boolean {
  const rowTarget = trackerSnapshotTargetFromRecord(row);
  return !!rowTarget && rowTarget.messageId === target.messageId && rowTarget.swipeIndex === target.swipeIndex;
}

function newestMatchingSnapshot(
  rows: Array<Record<string, unknown>>,
  chatId: string,
  predicate: (row: Record<string, unknown>) => boolean,
): GameState | null {
  for (const row of rows) {
    if (!predicate(row)) continue;
    const snapshot = normalizeTrackerSnapshotRow(row, chatId);
    if (snapshot) return snapshot;
  }
  return null;
}

export async function getTrackerSnapshotForTarget(
  storage: StorageGateway,
  chatId: string,
  target: TrackerSnapshotTurnTarget | null,
  context?: TrackerSnapshotReadContext,
): Promise<GameState | null> {
  if (!target) return null;
  const rows = context?.rows ?? (await listTrackerSnapshotRows(storage, chatId));
  return newestMatchingSnapshot(rows, chatId, (row) => targetMatches(row, target));
}

export async function copyTrackerSnapshotsForRebasedMessages(
  storage: StorageGateway,
  sourceChatId: string,
  targetChatId: string,
  messages: readonly TrackerSnapshotMessageRebase[],
): Promise<GameState | null> {
  if (!sourceChatId || !targetChatId || messages.length === 0) return null;

  const messageIdMap = new Map<string, string>();
  const rebasedAssistantTargets = new Map<string, TrackerSnapshotTurnTarget>();
  for (const message of messages) {
    const sourceMessageId = readString(message.sourceMessageId).trim();
    const targetMessageId = readString(message.targetMessageId).trim();
    if (!sourceMessageId || !targetMessageId) continue;
    messageIdMap.set(sourceMessageId, targetMessageId);
    const rebasedTarget = trackerSnapshotTargetFromRebasedMessage(message);
    if (rebasedTarget) rebasedAssistantTargets.set(sourceMessageId, rebasedTarget);
  }

  if (messageIdMap.size === 0) return null;

  let copied = false;
  const copiedVisibleTargetKeys = new Set<string>();
  const rows = await listTrackerSnapshotRows(storage, sourceChatId);
  for (const row of rows) {
    const sourceTarget = trackerSnapshotTargetFromRecord(row);
    const targetMessageId = sourceTarget ? messageIdMap.get(sourceTarget.messageId) : null;
    if (!sourceTarget || !targetMessageId) continue;
    const next: Record<string, unknown> = {
      ...row,
      chatId: targetChatId,
      messageId: targetMessageId,
    };
    delete next.id;
    try {
      await storage.create("game-state-snapshots", next);
    } catch (error) {
      console.warn("[tracker-snapshots] Failed to copy rebased tracker snapshot", error);
      continue;
    }
    const rebasedTarget = rebasedAssistantTargets.get(sourceTarget.messageId);
    if (rebasedTarget?.messageId === targetMessageId && rebasedTarget.swipeIndex === sourceTarget.swipeIndex) {
      copiedVisibleTargetKeys.add(`${rebasedTarget.messageId}\u0000${rebasedTarget.swipeIndex}`);
    }
    copied = true;
  }

  if (!copied) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const sourceMessageId = readString(messages[index]?.sourceMessageId).trim();
    const rebasedTarget = rebasedAssistantTargets.get(sourceMessageId);
    if (!rebasedTarget) continue;
    if (copiedVisibleTargetKeys.has(`${rebasedTarget.messageId}\u0000${rebasedTarget.swipeIndex}`)) {
      return getTrackerSnapshotForTarget(storage, targetChatId, rebasedTarget);
    }
  }
  return null;
}

export async function selectTrackerSnapshotForGeneration(
  storage: StorageGateway,
  chatId: string,
  options: TrackerSnapshotSelectionOptions = {},
  context?: TrackerSnapshotReadContext,
): Promise<GameState | null> {
  const rows = context?.rows ?? (await listTrackerSnapshotRows(storage, chatId));
  const fallbackTargets = new Set(
    (options.fallbackTargets ?? []).filter((target) => target?.messageId !== undefined).map(trackerTargetKey),
  );
  const hasFallbacks = fallbackTargets.size > 0;
  const excludeMessageId = readString(options.excludeMessageId).trim();
  const eligible = (row: Record<string, unknown>) => {
    const target = trackerSnapshotTargetFromRecord(row);
    if (!target) return false;
    if (hasFallbacks) return fallbackTargets.has(trackerTargetKey(target));
    if (excludeMessageId) return target.messageId !== excludeMessageId;
    return true;
  };
  const latestCommitted = () =>
    newestMatchingSnapshot(rows, chatId, (row) => eligible(row) && boolish(row.committed, false));
  const latestAny = () => newestMatchingSnapshot(rows, chatId, eligible);

  if (options.preferLatestVisible) {
    if (options.visibleAnchor?.messageId) {
      const visible = newestMatchingSnapshot(rows, chatId, (row) => targetMatches(row, options.visibleAnchor!));
      if (visible) return visible;
    }
    return latestCommitted() ?? latestAny();
  }

  return latestCommitted() ?? latestAny();
}

export async function commitTrackerSnapshotForTarget(
  storage: StorageGateway,
  chatId: string,
  target: TrackerSnapshotTurnTarget | null,
): Promise<GameState | null> {
  const existing = await getTrackerSnapshotForTarget(storage, chatId, target);
  if (!existing) return null;
  if (existing.committed === true) return existing;
  const saved = await storage.saveTrackerSnapshot<GameState>(chatId, {
    ...(existing as unknown as Record<string, unknown>),
    committed: true,
  });
  return normalizeGameState(saved, chatId, { messageId: existing.messageId, swipeIndex: existing.swipeIndex });
}

function gameStatePatchFromAgentResult(result: AgentResult, snapshot: GameState): TrackerStatePatch | null {
  if (!result.success) return null;
  const data = parseRecord(result.data);
  if (!Object.keys(data).length) return null;

  if (result.agentType === "world-state" || result.type === "game_state_update") {
    const patch: TrackerStatePatch = {};
    for (const field of ["date", "time", "location", "weather", "temperature"] as const) {
      if (Object.prototype.hasOwnProperty.call(data, field)) patch[field] = readNullableString(data[field]);
    }
    return Object.keys(patch).length ? patch : null;
  }

  if (result.agentType === "character-tracker" || result.type === "character_tracker_update") {
    const presentCharacters = Array.isArray(data.presentCharacters)
      ? data.presentCharacters
          .map(parsePresentCharacter)
          .filter((character): character is PresentCharacter => !!character)
      : [];
    preserveTrackerCharacterUiFields(
      presentCharacters as unknown as Array<Record<string, unknown>>,
      snapshot.presentCharacters as unknown as Array<Record<string, unknown>>,
    );
    return { presentCharacters };
  }

  if (result.agentType === "persona-stats" || result.type === "persona_stats_update") {
    const playerStats = clonePlayerStats(snapshot.playerStats);
    if (Object.prototype.hasOwnProperty.call(data, "status")) playerStats.status = readString(data.status).trim();
    if (Array.isArray(data.inventory)) {
      playerStats.inventory = data.inventory.map(parseInventoryItem).filter((item): item is InventoryItem => !!item);
    }
    const patch: TrackerStatePatch = { playerStats };
    if (Array.isArray(data.stats)) {
      patch.personaStats = data.stats.map(parseStat).filter((stat): stat is CharacterStat => !!stat);
    }
    return patch;
  }

  if (result.agentType === "custom-tracker" || result.type === "custom_tracker_update") {
    if (!Array.isArray(data.fields)) return null;
    const playerStats = clonePlayerStats(snapshot.playerStats);
    playerStats.customTrackerFields = data.fields
      .map(parseCustomTrackerField)
      .filter((field): field is CustomTrackerField => !!field);
    return { playerStats };
  }

  if (result.agentType === "quest" || result.type === "quest_update") {
    const questMerge = applyQuestUpdatesToPlayerStats(snapshot.playerStats, data.updates);
    return questMerge.changed ? { playerStats: questMerge.playerStats } : null;
  }

  return null;
}

export async function persistTrackerSnapshotForTurn(
  storage: StorageGateway,
  chatId: string,
  target: TrackerSnapshotTurnTarget | null,
  results: AgentResult[],
  options: { baseSnapshot?: GameState | null } = {},
): Promise<GameState | null> {
  if (!target || !target.messageId || results.length === 0) return null;
  const existing = await getTrackerSnapshotForTarget(storage, chatId, target);
  const chat =
    existing || options.baseSnapshot ? null : parseRecord(await storage.get("chats", chatId).catch(() => null));
  let snapshot = normalizeGameState(existing ?? options.baseSnapshot ?? chat?.gameState, chatId, target);
  if (!existing) {
    snapshot = { ...snapshot, id: "", committed: false, manualOverrides: null, createdAt: nowIso() };
  }
  let changed = false;

  for (const result of results) {
    const patch = gameStatePatchFromAgentResult(result, snapshot);
    if (!patch) continue;
    snapshot = normalizeGameState({ ...snapshot, ...patch }, chatId, target);
    changed = true;
  }

  if (!changed) return null;

  const saved = await storage.saveTrackerSnapshot<GameState>(chatId, snapshot as unknown as Record<string, unknown>);
  const savedState = normalizeGameState(saved, chatId, target);
  await storage.update("chats", chatId, { gameState: savedState as unknown as Record<string, unknown> });
  return savedState;
}
