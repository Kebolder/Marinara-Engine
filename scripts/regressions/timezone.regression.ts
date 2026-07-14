import assert from "node:assert/strict";
import { normalizeRuntimeTimezoneEnv } from "../../packages/server/src/config/runtime-config.js";
import {
  formatZonedConversationTime,
  getZonedDayBounds,
  normalizePromptTimeZone,
} from "../../packages/server/src/services/conversation/timezone.js";

const blankEnv: NodeJS.ProcessEnv = { TZ: "   " };
assert.equal(normalizeRuntimeTimezoneEnv(blankEnv), true);
assert.equal("TZ" in blankEnv, false);

const configuredEnv: NodeJS.ProcessEnv = { TZ: "Europe/Warsaw" };
assert.equal(normalizeRuntimeTimezoneEnv(configuredEnv), false);
assert.equal(configuredEnv.TZ, "Europe/Warsaw");

assert.equal(normalizePromptTimeZone(" Europe/Warsaw "), "Europe/Warsaw");
assert.equal(normalizePromptTimeZone("Not/A_Timezone"), undefined);
assert.equal(formatZonedConversationTime(new Date("2026-07-14T12:30:00.000Z"), "Europe/Warsaw"), "14:30");

const springForwardDay = getZonedDayBounds(new Date("2026-03-08T12:00:00.000Z"), "America/New_York");
assert.equal(springForwardDay.start.toISOString(), "2026-03-08T05:00:00.000Z");
assert.equal(springForwardDay.end.toISOString(), "2026-03-09T03:59:59.999Z");

console.log("Timezone regression checks passed.");
