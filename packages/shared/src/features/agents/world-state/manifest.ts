import type { BuiltInAgentManifest } from "../agent-manifest.types.js";

export const worldStateAgentManifest = {
  id: "world-state",
  name: "World State",
  description: "Tracks date, time, weather, location, temperature, and custom world details automatically.",
  phase: "post_processing",
  enabledByDefault: false,
  defaultInjectAsSection: true,
  category: "tracker",
  modeAllowlist: ["roleplay", "visual_novel"],
  defaultTools: [],
} satisfies BuiltInAgentManifest;
