import { Search } from "lucide-react";

interface GamePeekPromptButtonProps {
  messageId: string;
  className: string;
  onPeekPrompt: (messageId: string) => void;
}

export default function GamePeekPromptButton({
  messageId,
  className,
  onPeekPrompt,
}: GamePeekPromptButtonProps) {
  return (
    <button
      type="button"
      data-component="GameNarration.PeekPrompt"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onPeekPrompt(messageId);
      }}
      className={className}
      title="Peek prompt"
      aria-label="Peek prompt"
    >
      <Search size={11} />
    </button>
  );
}
