import type { CSSProperties } from "react";
import { Swords } from "lucide-react";
import type { GameCombatStyle } from "@marinara-engine/shared";
import { ChatSettingsSection } from "../ChatSettingsSection";

interface CombatStyleSectionProps {
  style?: CSSProperties;
  combatStyle: GameCombatStyle;
  onCombatStyleChange: (style: GameCombatStyle) => void;
}

export function CombatStyleSection({ style, combatStyle, onCombatStyleChange }: CombatStyleSectionProps) {
  return (
    <ChatSettingsSection
      style={style}
      label="Combat Style"
      icon={<Swords size="0.875rem" />}
      help="Choose how battles play out when the Game Master starts an encounter."
    >
      <div className="space-y-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Battle system</span>
          <select
            value={combatStyle}
            onChange={(event) => onCombatStyleChange(event.target.value as GameCombatStyle)}
            className="mari-preset-native-select w-full truncate rounded-lg bg-[var(--secondary)] px-3 py-2 pr-8 text-xs text-[var(--foreground)] outline-none ring-1 ring-[var(--border)] transition-shadow focus:ring-[var(--primary)]/40"
          >
            <option value="classic">Classic — cinematic menu battles</option>
            <option value="tactical">Tactical — Fire Emblem-style grid battles</option>
          </select>
        </label>
        <p className="text-[0.575rem] leading-relaxed text-[var(--muted-foreground)]">
          Takes effect at the next battle. Battles already in progress keep their current style.
        </p>
      </div>
    </ChatSettingsSection>
  );
}
