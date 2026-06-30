// ──────────────────────────────────────────────
// Service: Character ↔ Linked Lorebook sync
// ──────────────────────────────────────────────
//
// When an embedded lorebook is imported via
// POST /characters/:id/embedded-lorebook/import the resulting standalone
// lorebook keeps a back-pointer (`lorebooks.characterId`) to its source
// character, and the character keeps a forward pointer at
// `data.extensions.importMetadata.embeddedLorebook.lorebookId`.
//
// Subsequent edits flow through /lorebooks/* — they mutate the standalone
// row and entries but, without sync, leave the V2 `data.character_book`
// frozen at import time. The character editor's Lorebook tab reads from
// `data.character_book` directly, so deletes/edits made via "Edit Linked
// Lorebook" appeared to roll back when the editor was reopened (issue:
// users could not delete embedded lorebook entries).
//
// These helpers mirror standalone-lorebook mutations back into the
// character's `data.character_book` so the two stores stay coherent.

import type { DB } from "../../db/connection.js";
import type { CharacterBook, CharacterBookEntry } from "@marinara-engine/shared";
import { createLorebooksStorage } from "../storage/lorebooks.storage.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { logger } from "../../lib/logger.js";

type LoreEntryRow = Record<string, unknown>;
type LorebookRow = Record<string, unknown>;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

/**
 * Map a standalone-lorebook entry row (post `parseEntryRow`) onto a V2
 * Character Book entry. Field mapping mirrors the inverse done by
 * `importSTLorebook`. At-depth entries use ST's numeric @D position so a
 * synced embedded book can round-trip through the standalone lorebook without
 * losing depth placement.
 */
function toCharacterBookEntry(entry: LoreEntryRow, index: number): CharacterBookEntry {
  const order = asNumber(entry.order, 100);
  const positionValue = asNumber(entry.position, 0);
  const position = positionValue === 2 ? 4 : positionValue === 1 ? "after_char" : "before_char";
  const role = entry.role === "user" ? 1 : entry.role === "assistant" ? 2 : 0;
  return {
    keys: asStringArray(entry.keys),
    content: asString(entry.content),
    extensions: {},
    enabled: asBoolean(entry.enabled),
    insertion_order: order,
    case_sensitive: asBoolean(entry.caseSensitive),
    name: asString(entry.name, `Entry ${index + 1}`),
    priority: order,
    id: index,
    comment: asString(entry.name, `Entry ${index + 1}`),
    description: asString(entry.description),
    selective: asBoolean(entry.selective),
    secondary_keys: asStringArray(entry.secondaryKeys),
    constant: asBoolean(entry.constant),
    position,
    depth: asNumber(entry.depth, 4),
    role,
    selectiveLogic: asString(entry.selectiveLogic, "and"),
    probability: asNullableNumber(entry.probability),
    scanDepth: asNullableNumber(entry.scanDepth),
    scan_depth: asNullableNumber(entry.scanDepth),
    matchWholeWords: asBoolean(entry.matchWholeWords),
    match_whole_words: asBoolean(entry.matchWholeWords),
    useRegex: asBoolean(entry.useRegex),
    regex: asBoolean(entry.useRegex),
    sticky: asNullableNumber(entry.sticky),
    cooldown: asNullableNumber(entry.cooldown),
    delay: asNullableNumber(entry.delay),
    ephemeral: asNullableNumber(entry.ephemeral),
    group: asString(entry.group),
    groupWeight: asNullableNumber(entry.groupWeight),
    tag: asString(entry.tag),
    locked: asBoolean(entry.locked),
    preventRecursion: asBoolean(entry.preventRecursion, true),
    excludeRecursion: asBoolean(entry.excludeRecursion),
    delayUntilRecursion: asBoolean(entry.delayUntilRecursion),
    vectorized: !asBoolean(entry.excludeFromVectorization),
    excludeFromVectorization: asBoolean(entry.excludeFromVectorization),
  };
}

function toCharacterBook(lorebook: LorebookRow, entries: LoreEntryRow[]): CharacterBook {
  return {
    name: asString(lorebook.name, "Character Lorebook"),
    description: asString(lorebook.description),
    scan_depth: asNumber(lorebook.scanDepth, 2),
    token_budget: asNumber(lorebook.tokenBudget, 2048),
    recursive_scanning: lorebook.recursiveScanning === true,
    extensions: {},
    entries: entries.map((entry, index) => toCharacterBookEntry(entry, index)),
  };
}

function parseCharacterData(data: unknown): Record<string, unknown> {
  if (typeof data === "string") return JSON.parse(data) as Record<string, unknown>;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function getEmbeddedLorebookId(characterData: Record<string, unknown>): string | null {
  const extensions =
    characterData.extensions && typeof characterData.extensions === "object"
      ? (characterData.extensions as Record<string, unknown>)
      : null;
  const importMetadata =
    extensions?.importMetadata && typeof extensions.importMetadata === "object"
      ? (extensions.importMetadata as Record<string, unknown>)
      : null;
  const embeddedLorebook =
    importMetadata?.embeddedLorebook && typeof importMetadata.embeddedLorebook === "object"
      ? (importMetadata.embeddedLorebook as Record<string, unknown>)
      : null;
  return typeof embeddedLorebook?.lorebookId === "string" ? embeddedLorebook.lorebookId : null;
}

/**
 * Mirror the current state of a standalone lorebook into its source
 * character's `data.character_book`. No-op when the lorebook has no
 * `characterId`, or when the character's embedded-lorebook metadata does
 * not point at this lorebook. Ordinary character-scoped lorebooks also use
 * `characterId` for auto-activation, but they must not overwrite the V2
 * embedded `character_book`.
 *
 * Sync errors are logged but never thrown — the user's primary mutation
 * (entry create/update/delete) has already succeeded by the time this is
 * called, and a sync failure should not surface as an HTTP error.
 */
export async function syncCharacterBookFromLorebook(db: DB, lorebookId: string): Promise<void> {
  try {
    const lorebookStorage = createLorebooksStorage(db);
    const lorebook = (await lorebookStorage.getById(lorebookId)) as LorebookRow | null;
    if (!lorebook) return;
    const characterId = typeof lorebook.characterId === "string" ? lorebook.characterId : null;
    if (!characterId) return;

    const charactersStorage = createCharactersStorage(db);
    const character = await charactersStorage.getById(characterId);
    if (!character) return;

    const currentData = parseCharacterData(character.data);
    if (getEmbeddedLorebookId(currentData) !== lorebookId) return;

    const entries = (await lorebookStorage.listEntries(lorebookId)) as LoreEntryRow[];
    const nextBook = toCharacterBook(lorebook, entries);

    await charactersStorage.update(characterId, { character_book: nextBook }, undefined, { skipVersionSnapshot: true });
  } catch (err) {
    logger.error(err, "Failed to sync character_book from lorebook %s", lorebookId);
  }
}

/**
 * Clear the embedded-lorebook footprint from a character: drop
 * `data.character_book` and the
 * `extensions.importMetadata.embeddedLorebook` pointer. Called when the
 * standalone lorebook is being deleted, so the V2 `character_book` cannot
 * resurrect on the next character open and the dangling
 * `lorebookId` pointer cannot leave a broken "Edit Linked Lorebook"
 * button behind.
 *
 * The character storage layer's `update` does a shallow merge of
 * `CharacterData` fields, so we read-modify-write the `extensions`
 * subtree explicitly instead of relying on the merge to preserve sibling
 * keys.
 */
export async function clearCharacterEmbeddedLorebook(db: DB, characterId: string, lorebookId: string): Promise<void> {
  try {
    const charactersStorage = createCharactersStorage(db);
    const character = await charactersStorage.getById(characterId);
    if (!character) return;

    const currentData = parseCharacterData(character.data);
    if (getEmbeddedLorebookId(currentData) !== lorebookId) return;

    const extensions =
      currentData.extensions && typeof currentData.extensions === "object"
        ? ({ ...(currentData.extensions as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const importMetadata =
      extensions.importMetadata && typeof extensions.importMetadata === "object"
        ? ({ ...(extensions.importMetadata as Record<string, unknown>) } as Record<string, unknown>)
        : null;
    if (importMetadata && "embeddedLorebook" in importMetadata) {
      delete importMetadata.embeddedLorebook;
      extensions.importMetadata = importMetadata;
    }

    await charactersStorage.update(
      characterId,
      {
        character_book: null,
        extensions: extensions as never,
      },
      undefined,
      { skipVersionSnapshot: true },
    );
  } catch (err) {
    logger.error(err, "Failed to clear embedded lorebook for character %s", characterId);
  }
}
