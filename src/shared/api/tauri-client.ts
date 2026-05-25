import { invoke } from "@tauri-apps/api/core";
import { ApiError } from "./api-errors";
import { invokeRemote, isRemoteCommand, remoteRuntimeTarget } from "./remote-runtime";

function normalize(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : "";
    const status =
      code === "not_found" ? 404 : code === "invalid_input" ? 400 : code === "connection_in_use" ? 409 : 500;
    const message = typeof record.message === "string" ? record.message : "Tauri command failed";
    return new ApiError(message, status, record);
  }
  return new ApiError(String(error ?? "Tauri command failed"), 500, error);
}

export async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (remoteRuntimeTarget() && isRemoteCommand(command)) {
    return invokeRemote<T>(command, args);
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalize(error);
  }
}
