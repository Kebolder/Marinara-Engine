// ──────────────────────────────────────────────
// Hook: Global Roleplay Chat Summary prompt settings
// ──────────────────────────────────────────────
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CHAT_SUMMARY_PROMPT_SETTINGS_KEY,
  type ChatSummaryPromptSettings,
  type ChatSummaryPromptTemplate,
} from "@marinara-engine/shared";
import { api } from "../lib/api-client";

type AppSettingResponse = { value: string | null };
type ChatSummaryPromptSettingsState = ChatSummaryPromptSettings & {
  hasPersistedSettings: boolean;
};

export const chatSummaryPromptKeys = {
  settings: ["app-settings", CHAT_SUMMARY_PROMPT_SETTINGS_KEY] as const,
};

function normalizeTemplates(value: unknown): ChatSummaryPromptTemplate[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const templates: ChatSummaryPromptTemplate[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
    if (!id || !name || !prompt || seen.has(id)) continue;
    seen.add(id);
    templates.push({ id, name, prompt });
  }
  return templates;
}

export function normalizeChatSummaryPromptSettings(value: unknown): ChatSummaryPromptSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { templates: [], activeTemplateId: null };
  }
  const record = value as Record<string, unknown>;
  const templates = normalizeTemplates(record.templates);
  const activeTemplateId =
    typeof record.activeTemplateId === "string" && record.activeTemplateId.trim()
      ? record.activeTemplateId.trim()
      : null;
  return {
    templates,
    activeTemplateId:
      activeTemplateId && templates.some((template) => template.id === activeTemplateId) ? activeTemplateId : null,
  };
}

function parseSettingsValue(value: string | null): ChatSummaryPromptSettingsState {
  const hasPersistedSettings = typeof value === "string" && value.trim().length > 0;
  if (!hasPersistedSettings) return { templates: [], activeTemplateId: null, hasPersistedSettings };
  try {
    return { ...normalizeChatSummaryPromptSettings(JSON.parse(value) as unknown), hasPersistedSettings };
  } catch {
    return { templates: [], activeTemplateId: null, hasPersistedSettings };
  }
}

export function useChatSummaryPromptSettings() {
  return useQuery({
    queryKey: chatSummaryPromptKeys.settings,
    queryFn: async () => {
      const result = await api.get<AppSettingResponse>(`/app-settings/${CHAT_SUMMARY_PROMPT_SETTINGS_KEY}`);
      return parseSettingsValue(result.value);
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpdateChatSummaryPromptSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: ChatSummaryPromptSettings) => {
      const normalized = normalizeChatSummaryPromptSettings(settings);
      await api.put(`/app-settings/${CHAT_SUMMARY_PROMPT_SETTINGS_KEY}`, {
        value: JSON.stringify(normalized),
      });
      return normalized;
    },
    onSuccess: (settings) => {
      qc.setQueryData(chatSummaryPromptKeys.settings, { ...settings, hasPersistedSettings: true });
    },
  });
}
