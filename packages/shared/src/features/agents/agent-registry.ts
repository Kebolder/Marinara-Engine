import type { BuiltInAgentManifest } from "./agent-manifest.types.js";
/** The lightweight Engine ships no agent definitions; packages populate the active registry. */
export const BUNDLED_AGENT_MANIFESTS: readonly BuiltInAgentManifest[] = [];

/** Active runtime registry. Fresh installs populate it only from downloaded packages. */
export const BUILT_IN_AGENT_MANIFESTS: BuiltInAgentManifest[] = [];

export function replaceBuiltInAgentManifestRegistry(manifests: readonly BuiltInAgentManifest[]): void {
  BUILT_IN_AGENT_MANIFESTS.splice(0, BUILT_IN_AGENT_MANIFESTS.length, ...manifests);
}

export function getBuiltInAgentManifest(agentId: string): BuiltInAgentManifest | null {
  return BUILT_IN_AGENT_MANIFESTS.find((agent) => agent.id === agentId) ?? null;
}

export function getBuiltInAgentDefaultPrompt(agentId: string): string {
  return getBuiltInAgentManifest(agentId)?.defaultPromptTemplate ?? "";
}

export function isBuiltInAgentHiddenFromLibrary(agentId: string): boolean {
  return getBuiltInAgentManifest(agentId)?.libraryHidden === true;
}

export function isBuiltInAgentRuntimeDisabled(agentId: string): boolean {
  return getBuiltInAgentManifest(agentId)?.runtimeDisabled === true;
}
