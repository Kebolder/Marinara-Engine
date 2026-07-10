import assert from "node:assert/strict";
import { findKnownModel } from "../../packages/shared/src/constants/model-lists.js";
import {
  applyGlmThinkingParameters,
  isNativeGlmEndpoint,
} from "../../packages/server/src/services/llm/providers/glm-request-compat.js";
import {
  NOODLE_JSON_OUTPUT_HEADING,
  noodleResponseFormat,
} from "../../packages/server/src/services/noodle/noodle-response-format.js";

function assertStrictObjects(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.type === "object") assert.equal(record.additionalProperties, false);
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) nested.forEach(assertStrictObjects);
    else assertStrictObjects(nested);
  }
}

assert.match(NOODLE_JSON_OUTPUT_HEADING, /JSON/u);
assert.deepEqual(noodleResponseFormat("gpt-4o", "timeline"), { type: "json_object" });
const solTimelineFormat = noodleResponseFormat("gpt-5.6-sol", "timeline");
assert.equal(solTimelineFormat.type, "json_schema");
assert.equal(solTimelineFormat.name, "noodle_timeline");
assert.equal(solTimelineFormat.strict, true);
assertStrictObjects(solTimelineFormat.schema);
const solProfileFormat = noodleResponseFormat("gpt-5.6-sol", "profiles");
assert.equal(solProfileFormat.name, "noodle_profiles");
assertStrictObjects(solProfileFormat.schema);

const glm52 = findKnownModel("custom", "glm-5.2");
assert.equal(glm52?.context, 1_000_000);
assert.equal(glm52?.maxOutput, 128_000);
assert.equal(isNativeGlmEndpoint("https://api.z.ai/api/paas/v4/"), true);
assert.equal(isNativeGlmEndpoint("https://example.com/v1"), false);

const glm52HighBody: Record<string, unknown> = {};
assert.equal(
  applyGlmThinkingParameters(glm52HighBody, {
    model: "glm-5.2",
    baseUrl: "https://api.z.ai/api/paas/v4/",
    providerKind: "custom",
    enableThinking: true,
    reasoningEffort: "high",
  }),
  true,
);
assert.deepEqual(glm52HighBody.thinking, { type: "enabled" });
assert.equal(glm52HighBody.reasoning_effort, "high");
assert.equal("enable_thinking" in glm52HighBody, false);

const glm52MaxBody: Record<string, unknown> = {};
applyGlmThinkingParameters(glm52MaxBody, {
  model: "glm-5.2",
  baseUrl: "https://api.z.ai/api/paas/v4/",
  providerKind: "custom",
  reasoningEffort: "xhigh",
});
assert.deepEqual(glm52MaxBody, { thinking: { type: "enabled" }, reasoning_effort: "max" });

const glm52DisabledBody: Record<string, unknown> = {};
applyGlmThinkingParameters(glm52DisabledBody, {
  model: "glm-5.2",
  baseUrl: "https://api.z.ai/api/paas/v4/",
  providerKind: "custom",
  enableThinking: false,
  reasoningEffort: "none",
});
assert.deepEqual(glm52DisabledBody, { thinking: { type: "disabled" } });

const legacyGlmBody: Record<string, unknown> = {};
applyGlmThinkingParameters(legacyGlmBody, {
  model: "glm-5",
  baseUrl: "https://api.z.ai/api/paas/v4/",
  providerKind: "custom",
  reasoningEffort: "high",
});
assert.deepEqual(legacyGlmBody, { enable_thinking: true });

const unrelatedCustomBody: Record<string, unknown> = {};
assert.equal(
  applyGlmThinkingParameters(unrelatedCustomBody, {
    model: "glm-5.2",
    baseUrl: "https://example.com/v1",
    providerKind: "custom",
    reasoningEffort: "high",
  }),
  false,
);
assert.deepEqual(unrelatedCustomBody, {});

process.stdout.write("Provider compatibility regression passed.\n");
