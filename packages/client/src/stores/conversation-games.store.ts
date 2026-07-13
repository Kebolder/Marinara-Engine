import { create } from "zustand";

interface ConversationGamesStore {
  pickerChatId: string | null;
  openPicker: (chatId: string) => void;
  closePicker: () => void;
}

export const useConversationGamesStore = create<ConversationGamesStore>((set) => ({
  pickerChatId: null,
  openPicker: (chatId) => set({ pickerChatId: chatId }),
  closePicker: () => set({ pickerChatId: null }),
}));
