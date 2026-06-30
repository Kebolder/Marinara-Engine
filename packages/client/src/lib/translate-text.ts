import { api } from "./api-client";
import { useTranslationStore } from "../stores/translation.store";

/** Standalone translate helper for on-demand translation flows. */
export async function translateText(text: string): Promise<string> {
  const store = useTranslationStore.getState();
  const result = await api.post<{ translatedText: string }>("/translate", {
    text,
    provider: store.config.provider,
    targetLanguage: store.config.targetLanguage,
    connectionId: store.config.connectionId,
    systemPrompt: store.config.systemPrompt,
    deeplApiKey: store.config.deeplApiKey,
    deeplxUrl: store.config.deeplxUrl,
  });
  return result.translatedText;
}
