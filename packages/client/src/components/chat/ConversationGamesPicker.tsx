import { ChevronRight, Gamepad2 } from "lucide-react";
import { CONVERSATION_GAMES } from "../../lib/conversation-games";
import { Modal } from "../ui/Modal";

interface Props {
  chatId: string;
  open: boolean;
  onClose: () => void;
}

export function ConversationGamesPicker({ chatId, open, onClose }: Props) {
  const startGame = (openSetup: (chatId: string) => void) => {
    onClose();
    openSetup(chatId);
  };

  return (
    <Modal open={open} onClose={onClose} title="Start a game" width="max-w-lg">
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {CONVERSATION_GAMES.map((game) => (
            <button
              key={game.id}
              type="button"
              onClick={() => startGame(game.openSetup)}
              className="group flex min-h-28 w-full flex-col justify-between rounded-lg border border-[var(--border)] bg-[var(--secondary)]/45 p-3 text-left transition-colors hover:border-[var(--primary)]/60 hover:bg-[var(--accent)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
            >
              <span className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)]/15 text-[var(--primary)]">
                    <Gamepad2 size="1rem" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--foreground)]">{game.name}</span>
                    <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">{game.playerLabel}</span>
                  </span>
                </span>
                <ChevronRight
                  size="1rem"
                  className="mt-1 shrink-0 text-[var(--muted-foreground)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--primary)]"
                />
              </span>
              <span className="mt-3 text-xs leading-5 text-[var(--muted-foreground)]">{game.description}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">
          You can also start these directly with {CONVERSATION_GAMES.map((game) => game.command).join(", ")}.
        </p>
      </div>
    </Modal>
  );
}
