import assert from "node:assert/strict";
import { TTS_API_KEY_MASK, ttsConfigSchema } from "../../packages/shared/src/types/tts.js";
import { maskTTSConfigForResponse, prepareTTSConfigForStorage } from "../../packages/server/src/routes/tts.routes.ts";

const encryptForTest = (value: string) => (value ? `encrypted:${value}` : "");

const legacyOpenAiConfig = ttsConfigSchema.parse({
  enabled: true,
  source: "openai",
  baseUrl: "https://speech.example.test/v1",
  apiKey: "encrypted:openai-secret",
  model: "custom-speech-model",
  voice: "nova",
  speed: 1.25,
});

const maskedOpenAiConfig = maskTTSConfigForResponse(legacyOpenAiConfig);
assert.equal(maskedOpenAiConfig.apiKey, TTS_API_KEY_MASK);
assert.equal(maskedOpenAiConfig.sourceProfiles.openai?.apiKey, TTS_API_KEY_MASK);

const switchToElevenLabs = ttsConfigSchema.parse({
  ...maskedOpenAiConfig,
  source: "elevenlabs",
  baseUrl: "https://api.elevenlabs.io",
  apiKey: "eleven-secret",
  model: "eleven_v3",
  voice: "eleven-voice-id",
  speed: 1.1,
});
const storedElevenLabs = prepareTTSConfigForStorage(switchToElevenLabs, legacyOpenAiConfig, encryptForTest);

assert.equal(storedElevenLabs.apiKey, "encrypted:eleven-secret");
assert.equal(storedElevenLabs.sourceProfiles.openai?.apiKey, "encrypted:openai-secret");
assert.equal(storedElevenLabs.sourceProfiles.openai?.model, "custom-speech-model");
assert.equal(storedElevenLabs.sourceProfiles.elevenlabs?.voice, "eleven-voice-id");

const maskedElevenLabs = maskTTSConfigForResponse(storedElevenLabs);
assert.equal(maskedElevenLabs.apiKey, TTS_API_KEY_MASK);
assert.equal(maskedElevenLabs.sourceProfiles.openai?.apiKey, TTS_API_KEY_MASK);
assert.equal(maskedElevenLabs.sourceProfiles.elevenlabs?.apiKey, TTS_API_KEY_MASK);
const savedOpenAiProfile = maskedElevenLabs.sourceProfiles.openai;
assert.ok(savedOpenAiProfile);

const switchToNewPocketTts = ttsConfigSchema.parse({
  ...maskedElevenLabs,
  source: "pockettts",
  baseUrl: "http://localhost:8000",
  apiKey: "",
  model: "pocket-tts",
  voice: "alba",
});
const storedPocketTts = prepareTTSConfigForStorage(switchToNewPocketTts, storedElevenLabs, encryptForTest);
assert.equal(storedPocketTts.apiKey, "");
assert.equal(storedPocketTts.sourceProfiles.openai?.apiKey, "encrypted:openai-secret");
assert.equal(storedPocketTts.sourceProfiles.elevenlabs?.apiKey, "encrypted:eleven-secret");

const switchBackToOpenAi = ttsConfigSchema.parse({
  ...maskedElevenLabs,
  source: "openai",
  ...savedOpenAiProfile,
});
const restoredOpenAi = prepareTTSConfigForStorage(switchBackToOpenAi, storedElevenLabs, encryptForTest);

assert.equal(restoredOpenAi.apiKey, "encrypted:openai-secret");
assert.equal(restoredOpenAi.baseUrl, "https://speech.example.test/v1");
assert.equal(restoredOpenAi.model, "custom-speech-model");
assert.equal(restoredOpenAi.voice, "nova");
assert.equal(restoredOpenAi.speed, 1.25);
assert.equal(restoredOpenAi.sourceProfiles.elevenlabs?.apiKey, "encrypted:eleven-secret");

console.info("TTS source persistence regression checks passed.");
