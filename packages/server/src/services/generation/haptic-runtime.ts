import type { HapticDeviceCommand } from "@marinara-engine/shared";

export function getChatHapticIntifaceUrl(meta: Record<string, unknown>): string | undefined {
  const url = meta.hapticIntifaceUrl;
  if (typeof url !== "string") return undefined;
  return url.trim() || undefined;
}

export function normalizeHapticAgentAction(action: unknown): HapticDeviceCommand["action"] | null {
  if (typeof action !== "string") return null;
  const key = action
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (key === "positionwithduration" || key === "hwpositionwithduration" || key === "linear") return "position";
  if (key === "vibrate") return "vibrate";
  if (key === "rotate") return "rotate";
  if (key === "oscillate") return "oscillate";
  if (key === "constrict") return "constrict";
  if (key === "inflate") return "inflate";
  if (key === "position") return "position";
  if (key === "stop") return "stop";
  return null;
}

function normalizeHapticAgentNumber(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeHapticAgentDeviceIndex(value: unknown): HapticDeviceCommand["deviceIndex"] {
  if (value === "all" || value === undefined || value === null) return "all";
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : "all";
}

export function normalizeHapticAgentCommand(command: Record<string, unknown>): HapticDeviceCommand | null {
  const action = normalizeHapticAgentAction(command.action);
  if (!action) return null;

  return {
    deviceIndex: normalizeHapticAgentDeviceIndex(command.deviceIndex),
    action,
    intensity: normalizeHapticAgentNumber(command.intensity),
    duration: normalizeHapticAgentNumber(command.duration),
  };
}

export function normalizeHapticAgentCommands(data: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(data.commands)) {
    return data.commands.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
    );
  }

  if (normalizeHapticAgentAction(data.action)) {
    return [data];
  }

  return [];
}
