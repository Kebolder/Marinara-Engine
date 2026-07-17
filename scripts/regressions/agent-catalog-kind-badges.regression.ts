import assert from "node:assert/strict";
import { isAgentCatalogKindBadgeVisible } from "../../packages/client/src/lib/agent-catalog-kind-badges.js";

assert.equal(isAgentCatalogKindBadgeVisible("agent"), true);
assert.equal(isAgentCatalogKindBadgeVisible("conversation-calls"), true);
assert.equal(isAgentCatalogKindBadgeVisible("maps"), false);
assert.equal(isAgentCatalogKindBadgeVisible("turn-game"), false);

console.info("Agent catalog kind badge regressions passed.");
