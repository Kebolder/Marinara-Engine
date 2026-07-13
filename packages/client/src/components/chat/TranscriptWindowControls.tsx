import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../../lib/utils";

type TranscriptWindowControlsProps = {
  hiddenBeforeCount: number;
  hiddenAfterCount: number;
  onShowOlder?: () => void;
  onShowNewer?: () => void;
  onJumpToLatest?: () => void;
  className?: string;
  buttonClassName?: string;
};

export function TranscriptWindowControls({
  hiddenBeforeCount,
  hiddenAfterCount,
  onShowOlder,
  onShowNewer,
  onJumpToLatest,
  className,
  buttonClassName,
}: TranscriptWindowControlsProps) {
  if (!onShowOlder && !onShowNewer && !onJumpToLatest) return null;

  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-2 px-3 py-2", className)}>
      {onShowOlder && hiddenBeforeCount > 0 && (
        <button
          type="button"
          onClick={onShowOlder}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)]",
            buttonClassName,
          )}
        >
          <ChevronUp size="0.75rem" />
          Show older ({hiddenBeforeCount})
        </button>
      )}
      {onShowNewer && hiddenAfterCount > 0 && (
        <button
          type="button"
          onClick={onShowNewer}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)]",
            buttonClassName,
          )}
        >
          <ChevronDown size="0.75rem" />
          Show newer ({hiddenAfterCount})
        </button>
      )}
      {onJumpToLatest && hiddenAfterCount > 0 && (
        <button
          type="button"
          onClick={onJumpToLatest}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)]",
            buttonClassName,
          )}
        >
          Latest
        </button>
      )}
    </div>
  );
}
