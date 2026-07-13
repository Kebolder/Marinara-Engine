// ──────────────────────────────────────────────
// Noodle Prompt Context
// ──────────────────────────────────────────────
import type { ChatMode, NoodleCarryoverTarget } from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { wrapContent } from "../prompt/format-engine.js";
import { createNoodleStorage } from "../storage/noodle.storage.js";

function sinceHoursIso(hours: number) {
  return new Date(Date.now() - Math.max(1, hours) * 60 * 60 * 1000).toISOString();
}

function modeAllowed(carryoverModes: readonly NoodleCarryoverTarget[], chatMode: ChatMode) {
  if (carryoverModes.includes("conversation") && chatMode === "conversation") return true;
  if (carryoverModes.includes("roleplay") && (chatMode === "roleplay" || chatMode === "visual_novel")) return true;
  if (carryoverModes.includes("game") && chatMode === "game") return true;
  return false;
}

export async function buildRecentSocialMediaActivityBlock(input: {
  db: DB;
  chatMode: ChatMode;
  characterIds: string[];
  personaId: string | null;
  wrapFormat: "xml" | "markdown" | "none";
}): Promise<string | null> {
  const noodle = createNoodleStorage(input.db);
  const settings = await noodle.getSettings();
  if (!modeAllowed(settings.carryoverModes, input.chatMode)) return null;

  const accountIds = new Set<string>();
  const characterAccounts = await noodle.getAccountsByEntities("character", input.characterIds);
  for (const account of characterAccounts) {
    if (account.invited) accountIds.add(account.id);
  }
  if (input.personaId) {
    const personaAccount = await noodle.getAccountByEntity("persona", input.personaId);
    if (personaAccount) accountIds.add(personaAccount.id);
  }
  if (accountIds.size === 0) return null;

  const digests = await noodle.listDigests({
    since: sinceHoursIso(settings.carryoverHours),
    limit: Math.max(settings.carryoverMaxItems * 4, 20),
  });
  const relevant = digests
    .filter((digest) => digest.accountIds.some((id) => accountIds.has(id)))
    .slice(0, settings.carryoverMaxItems)
    .reverse();
  if (relevant.length === 0) return null;

  const lines = relevant.map((digest) => `- ${digest.content}`);
  return wrapContent(lines.join("\n"), "Recent Social Media Activity", input.wrapFormat);
}
