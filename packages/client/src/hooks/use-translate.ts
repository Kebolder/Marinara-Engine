// ──────────────────────────────────────────────
// Hook: Translation — multi-provider message translation
// ──────────────────────────────────────────────
import { useCallback } from "react";
import { toast } from "sonner";
import { api } from "../lib/api-client";
import { useTranslationStore } from "../stores/translation.store";

// ── Hook ──
export function useTranslate() {
  const translations = useTranslationStore((s) => s.translations);
  const translating = useTranslationStore((s) => s.translating);
  const config = useTranslationStore((s) => s.config);

  const translate = useCallback(async (messageId: string, text: string, chatId?: string) => {
    const store = useTranslationStore.getState();

    // Toggle off if already translated. Keep the saved translation, but persist the hidden display state.
    if (store.translations[messageId]) {
      store.removeTranslation(messageId);
      if (chatId) {
        api.patch(`/chats/${chatId}/messages/${messageId}/extra`, { translationHidden: true }).catch(() => {});
      }
      return;
    }

    // Skip if already in-flight
    if (store.translating[messageId]) return;

    store.setTranslating(messageId, true);
    try {
      const result = await api.post<{ translatedText: string }>("/translate", {
        text,
        provider: store.config.provider,
        targetLanguage: store.config.targetLanguage,
        connectionId: store.config.connectionId,
        systemPrompt: store.config.systemPrompt,
        deeplApiKey: store.config.deeplApiKey,
        deeplxUrl: store.config.deeplxUrl,
      });
      store.setTranslation(messageId, result.translatedText);
      // Persist to message extra so translation survives refresh/chat switch
      if (chatId) {
        api
          .patch(`/chats/${chatId}/messages/${messageId}/extra`, {
            translation: result.translatedText,
            translationHidden: false,
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error("Translation failed:", err);
      toast.error(err instanceof Error ? err.message : "Translation failed");
    } finally {
      store.setTranslating(messageId, false);
    }
  }, []);

  return {
    translate,
    translations,
    translating,
    config,
  };
}
