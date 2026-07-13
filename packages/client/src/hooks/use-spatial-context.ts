import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SpatialContextDefinition, SpatialContextResponse, SpatialDefinitionIssue } from "@marinara-engine/shared";
import { api, ApiError } from "../lib/api-client";

export const spatialContextKeys = {
  all: ["spatial-context"] as const,
  detail: (chatId: string) => [...spatialContextKeys.all, chatId] as const,
};

export interface UpdateSpatialContextInput {
  chatId: string;
  expectedRevision: number;
  expectedCurrentLocationId: string | null;
  replacementCurrentLocationId?: string | null;
  definition: SpatialContextDefinition;
}

export interface SpatialContextProblem {
  status: number | null;
  code: string | null;
  message: string;
  issues: SpatialDefinitionIssue[];
  conflict: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readIssues(value: unknown): SpatialDefinitionIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.message !== "string") return [];
    const path = Array.isArray(candidate.path)
      ? candidate.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number")
      : [];
    const spatialCode =
      isRecord(candidate.params) && typeof candidate.params.spatialCode === "string"
        ? candidate.params.spatialCode
        : typeof candidate.code === "string" && candidate.code !== "custom"
          ? candidate.code
          : "stored_definition_invalid";
    const locationId =
      typeof candidate.locationId === "string"
        ? candidate.locationId
        : isRecord(candidate.params) && typeof candidate.params.locationId === "string"
          ? candidate.params.locationId
          : undefined;
    return [
      {
        code: spatialCode as SpatialDefinitionIssue["code"],
        message: candidate.message,
        path,
        ...(locationId ? { locationId } : {}),
      },
    ];
  });
}

export function getSpatialContextProblem(error: unknown): SpatialContextProblem {
  if (!(error instanceof ApiError)) {
    return {
      status: null,
      code: null,
      message: error instanceof Error ? error.message : "The hierarchical map could not be saved.",
      issues: [],
      conflict: false,
    };
  }

  const payload = isRecord(error.payload) ? error.payload : {};
  const code = typeof payload.code === "string" ? payload.code : null;
  return {
    status: error.status,
    code,
    message: error.message || "The hierarchical map could not be saved.",
    issues: readIssues(payload.issues),
    conflict: error.status === 409 || code === "spatial_definition_stale" || code === "spatial_current_location_stale",
  };
}

export function useSpatialContext(chatId: string | null) {
  return useQuery({
    queryKey: spatialContextKeys.detail(chatId ?? ""),
    queryFn: () => api.get<SpatialContextResponse>(`/chats/${chatId}/spatial-context`),
    enabled: !!chatId,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
      return failureCount < 3;
    },
  });
}

export function useUpdateSpatialContext() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, ...request }: UpdateSpatialContextInput) =>
      api.put<SpatialContextResponse>(`/chats/${chatId}/spatial-context`, request),
    onSuccess: (response, variables) => {
      queryClient.setQueryData(spatialContextKeys.detail(variables.chatId), response);
    },
    onError: (error, variables) => {
      if (getSpatialContextProblem(error).conflict) {
        void queryClient.invalidateQueries({ queryKey: spatialContextKeys.detail(variables.chatId) });
      }
    },
  });
}
