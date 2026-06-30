import { create } from "zustand";

// ── Translation config (set from chat metadata) ──
export interface TranslationConfig {
  provider: "ai" | "deeplx" | "deepl" | "google";
  targetLanguage: string;
  connectionId?: string;
  systemPrompt?: string;
  deeplApiKey?: string;
  deeplxUrl?: string;
}

// ── Zustand store for translation cache ──
interface TranslationStore {
  /** Config for the currently active chat */
  config: TranslationConfig;
  setConfig: (config: TranslationConfig) => void;
  /** messageId -> translated text */
  translations: Record<string, string>;
  /** messageId -> hidden translation display state */
  hiddenTranslationIds: Record<string, boolean>;
  /** messageId -> currently translating */
  translating: Record<string, boolean>;
  setTranslation: (id: string, text: string) => void;
  removeTranslation: (id: string) => void;
  setTranslating: (id: string, val: boolean) => void;
  /** Clear all translations (e.g. on chat switch) */
  clearAll: () => void;
  /** Seed translations from message extras (e.g. on chat load) */
  seedFromMessages: (messages: Array<{ id: string; extra?: string | Record<string, unknown> | null }>) => void;
}

export const useTranslationStore = create<TranslationStore>((set) => ({
  config: { provider: "google", targetLanguage: "en" },
  setConfig: (config) => set({ config }),
  translations: {},
  hiddenTranslationIds: {},
  translating: {},
  setTranslation: (id, text) =>
    set((s) => {
      const { [id]: _, ...hiddenRest } = s.hiddenTranslationIds;
      return {
        translations: { ...s.translations, [id]: text },
        hiddenTranslationIds: hiddenRest,
      };
    }),
  removeTranslation: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.translations;
      return { translations: rest, hiddenTranslationIds: { ...s.hiddenTranslationIds, [id]: true } };
    }),
  setTranslating: (id, val) => set((s) => ({ translating: { ...s.translating, [id]: val } })),
  clearAll: () => set({ translations: {}, translating: {}, hiddenTranslationIds: {} }),
  seedFromMessages: (messages) =>
    set((s) => {
      const seeded: Record<string, string> = {};
      for (const msg of messages) {
        if (!msg.extra) continue;
        try {
          const extra = typeof msg.extra === "string" ? JSON.parse(msg.extra) : msg.extra;
          if (
            extra.translation &&
            typeof extra.translation === "string" &&
            extra.translationHidden !== true &&
            !s.hiddenTranslationIds[msg.id]
          ) {
            seeded[msg.id] = extra.translation;
          }
        } catch {
          // Skip messages with malformed extra JSON
        }
      }
      // Merge with existing (in-flight translations win over seeded)
      return { translations: { ...seeded, ...s.translations } };
    }),
}));
