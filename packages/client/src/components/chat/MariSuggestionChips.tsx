import {
  BookOpen,
  Bot,
  Dices,
  Link2,
  MessageCircle,
  Settings,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import type { MariChipEntity, MariSuggestionChip } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";

interface MariSuggestionChipsProps {
  chips: MariSuggestionChip[];
  onSelect: (chip: MariSuggestionChip) => void;
  disabled?: boolean;
  compact?: boolean;
}

const CHIP_ICONS: Record<string, LucideIcon> = {
  UserPlus,
  BookOpen,
  Sparkles,
  Wand2,
  Dices,
};

const ENTITY_DEFAULT_ICON: Partial<Record<MariChipEntity, LucideIcon>> = {
  characters: UserPlus,
  lorebooks: BookOpen,
  personas: Sparkles,
  presets: SlidersHorizontal,
  connections: Link2,
  agents: Bot,
  settings: Settings,
  chat: MessageCircle,
};

export function MariSuggestionChips({ chips, onSelect, disabled = false, compact = false }: MariSuggestionChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div
      className={cn("mari-suggestion-chips", compact && "mari-suggestion-chips--compact")}
      role="group"
      aria-label="Suggested replies"
    >
      {chips.map((chip) => {
        const Icon = (chip.icon && CHIP_ICONS[chip.icon]) || (chip.entity && ENTITY_DEFAULT_ICON[chip.entity]) || undefined;
        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => onSelect(chip)}
            disabled={disabled}
            className={cn(
              "mari-suggestion-chip text-left",
              chip.entity && `mari-panel-gradient--${chip.entity}`,
              !chip.entity && !chip.tone && "mari-suggestion-chip--neutral",
              chip.tone === "danger" && "mari-suggestion-chip--danger",
              chip.tone === "caution" && "mari-suggestion-chip--caution",
              chip.tone === "success" && "mari-suggestion-chip--success",
            )}
            aria-label={chip.label}
            title={chip.prompt}
          >
            {Icon ? <Icon size={compact ? "0.75rem" : "0.875rem"} className="shrink-0" /> : null}
            <span className="min-w-0 truncate">{chip.label}</span>
          </button>
        );
      })}
    </div>
  );
}
