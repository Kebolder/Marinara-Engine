import { type ReactNode } from "react";
import { Eye, HeartPulse, Shirt } from "lucide-react";
import {
  characterTrackerLockKey,
  isTrackerFieldHidden,
  normalizeTrackerFieldLocks,
  normalizeTrackerHiddenFields,
  type CharacterStat,
  type PresentCharacter,
} from "@marinara-engine/shared";
import type { TrackerPanelSizeProfile } from "../../../../stores/ui.store";
import { cn } from "../../../../lib/utils";
import type { TrackerStatDensity } from "../../tracker-panel.types";
import { visibleText } from "../../lib/tracker-display";
import { InlineEdit } from "../controls/InlineControls";
import { StatList } from "../controls/StatList";
import { TRACKER_PROFILE_FIELD_TILE_CLASS } from "../controls/TrackerProfileChrome";
import { useTrackerFieldLock, useTrackerLockContext } from "../TrackerLockContext";

const FEATURED_FIELD_LIST_CLASS =
  "relative z-[1] grid h-full min-h-0 grid-cols-1 gap-0.5 overflow-hidden px-1 py-0.5";
const FEATURED_FIELD_ICON_CLASS =
  "relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[color-mix(in_srgb,var(--tracker-profile-icon)_58%,var(--tracker-profile-text)_42%)] opacity-[0.82] ring-1 ring-inset ring-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_18%,transparent)] transition-colors before:absolute before:inset-[3px] before:rounded-full before:bg-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_3%,transparent)] before:content-[''] group-hover/field:text-[color-mix(in_srgb,var(--tracker-profile-icon)_78%,var(--tracker-profile-text)_22%)] group-hover/field:ring-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_34%,transparent)] group-hover/field:before:bg-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_6%,transparent)] [&>svg]:relative [&>svg]:z-[1] [&>svg]:stroke-[1.85]";
type FeaturedFieldTone = "mood" | "appearance" | "outfit";
type FeaturedCharacterFieldKey = "mood" | "appearance" | "outfit";
const FEATURED_FIELD_ICON_TONE_CLASS = {
  mood: "text-[color-mix(in_srgb,var(--tracker-profile-icon)_70%,var(--tracker-profile-text)_30%)] before:bg-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_4%,transparent)] group-hover/field:text-[color-mix(in_srgb,var(--tracker-profile-icon)_84%,var(--tracker-profile-text)_16%)]",
  appearance:
    "text-[color-mix(in_srgb,var(--tracker-profile-icon)_58%,var(--tracker-profile-text)_42%)] before:bg-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_3%,transparent)] group-hover/field:text-[color-mix(in_srgb,var(--tracker-profile-icon)_76%,var(--tracker-profile-text)_24%)]",
  outfit:
    "text-[color-mix(in_srgb,var(--tracker-profile-icon)_50%,var(--tracker-profile-text)_50%)] before:bg-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_3%,transparent)] group-hover/field:text-[color-mix(in_srgb,var(--tracker-profile-icon)_68%,var(--tracker-profile-text)_32%)]",
} satisfies Record<FeaturedFieldTone, string>;
const FEATURED_FIELD_TILE_CLASS_BY_PROFILE = {
  compact: "py-0.5",
  standard: "py-1",
  expanded: "py-1",
} satisfies Record<TrackerPanelSizeProfile, string>;
const FEATURED_FIELD_TEXT_CLASS_BY_PROFILE = {
  compact: "text-[0.625rem] leading-[1.12]",
  standard: "text-[0.625rem] leading-[1.16]",
  expanded: "text-[0.6875rem] leading-[1.18]",
} satisfies Record<TrackerPanelSizeProfile, string>;
const FEATURED_FIELD_PREVIEW_LINES_BY_PROFILE = {
  compact: 2,
  standard: 3,
  expanded: 3,
} satisfies Record<TrackerPanelSizeProfile, 2 | 3 | 4>;
const FEATURED_FIELD_PREVIEW_CLASS_BY_PROFILE = {
  compact: "line-clamp-2",
  standard: "line-clamp-3",
  expanded: "line-clamp-3",
} satisfies Record<TrackerPanelSizeProfile, string>;
const FEATURED_STAT_SHELF_CLASS = cn(
  "group/statbox relative isolate flex min-h-0 flex-col overflow-x-hidden border-t border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_38%,transparent)] bg-[image:var(--tracker-profile-material)] p-1 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_4%,transparent),inset_0_8px_14px_color-mix(in_srgb,var(--background)_22%,transparent)] [background-blend-mode:var(--tracker-profile-material-blend)] before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:z-[1] before:h-px before:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--tracker-profile-dialogue-border)_34%,transparent),transparent)] before:opacity-55 before:content-['']",
  "max-h-[7.75rem] @min-[380px]:max-h-[9.25rem]",
);

function FeaturedFieldTile({
  icon,
  accessibleLabel,
  value,
  placeholder,
  onSave,
  readable = false,
  sizeProfile,
  tone,
  lockKey,
  hidden = false,
  hideMode = false,
  onToggleHidden,
}: {
  icon: ReactNode;
  accessibleLabel: string;
  value: string | null | undefined;
  placeholder: string;
  onSave?: (value: string) => void;
  readable?: boolean;
  sizeProfile: TrackerPanelSizeProfile;
  tone: FeaturedFieldTone;
  lockKey?: string;
  hidden?: boolean;
  hideMode?: boolean;
  onToggleHidden?: () => void;
}) {
  const lock = useTrackerFieldLock(lockKey);
  const hiddenToggleActive = hideMode && !!onToggleHidden;
  if (hidden && !hideMode) return null;
  const displayValue = visibleText(value, placeholder);
  const textClass = FEATURED_FIELD_TEXT_CLASS_BY_PROFILE[sizeProfile];
  const previewLines = FEATURED_FIELD_PREVIEW_LINES_BY_PROFILE[sizeProfile];

  return (
    <div
      className={cn(
        TRACKER_PROFILE_FIELD_TILE_CLASS,
        FEATURED_FIELD_TILE_CLASS_BY_PROFILE[sizeProfile],
        hidden && "opacity-60 grayscale",
      )}
    >
      <span
        className={cn(FEATURED_FIELD_ICON_CLASS, FEATURED_FIELD_ICON_TONE_CLASS[tone])}
        aria-label={accessibleLabel}
        title={accessibleLabel}
      >
        {icon}
      </span>
      {hiddenToggleActive ? (
        <button
          type="button"
          onClick={onToggleHidden}
          title={hidden ? `Show ${accessibleLabel.toLowerCase()}` : `Hide ${accessibleLabel.toLowerCase()}`}
          aria-label={hidden ? `Show ${accessibleLabel.toLowerCase()}` : `Hide ${accessibleLabel.toLowerCase()}`}
          aria-pressed={hidden}
          className={cn(
            "w-full min-w-0 self-center rounded px-0 py-0 text-left transition-colors hover:bg-[var(--accent)]/25",
            readable ? textClass : "h-4 text-[0.625rem] leading-4",
            hidden ? "italic text-[color-mix(in_srgb,var(--tracker-profile-muted-text)_62%,transparent)]" : "text-[color:var(--tracker-profile-text)]",
          )}
        >
          <span
            className={cn(
              readable ? "break-words [align-content:start]" : "block truncate text-[0.625rem]",
              readable && FEATURED_FIELD_PREVIEW_CLASS_BY_PROFILE[sizeProfile],
            )}
          >
            {hidden ? "Hidden" : displayValue}
          </span>
        </button>
      ) : onSave ? (
        <InlineEdit
          value={value ?? ""}
          onSave={onSave}
          placeholder={placeholder}
          className={cn(
            "w-full min-w-0 self-center px-0 py-0 text-[color:var(--tracker-profile-text)] hover:bg-[var(--accent)]/25",
            readable ? textClass : "h-4 text-[0.625rem] leading-4",
          )}
          scrollOnHover={!readable}
          twoLinePreview={readable}
          previewLineCount={previewLines}
          {...lock}
        />
      ) : (
        <span
          title={displayValue}
          className={cn(
            "self-center text-[color:var(--tracker-profile-text)]",
            readable ? "min-h-0 break-words [align-content:start]" : "block truncate text-[0.625rem]",
            readable && textClass,
            readable && FEATURED_FIELD_PREVIEW_CLASS_BY_PROFILE[sizeProfile],
          )}
        >
          {displayValue}
        </span>
      )}
    </div>
  );
}

export function FeaturedFieldList({
  character,
  onUpdate,
  readableRows = true,
  sizeProfile,
  characterIndex,
}: {
  character: PresentCharacter;
  onUpdate?: (character: PresentCharacter) => void;
  readableRows?: boolean;
  sizeProfile: TrackerPanelSizeProfile;
  characterIndex: number;
}) {
  const { hiddenTrackerFields, hideMode, onUpdateFieldLocks, onUpdateHiddenFields } = useTrackerLockContext();
  const fieldKey = (field: FeaturedCharacterFieldKey) => characterTrackerLockKey(character, characterIndex, field);
  const fieldHidden = (field: FeaturedCharacterFieldKey) => isTrackerFieldHidden(hiddenTrackerFields, fieldKey(field));
  const toggleFieldHidden = (field: FeaturedCharacterFieldKey) => {
    if (!onUpdate) return;
    const key = fieldKey(field);
    const nextHidden = !isTrackerFieldHidden(hiddenTrackerFields, key);
    onUpdateHiddenFields?.((hiddenFields) => {
      const next = normalizeTrackerHiddenFields(hiddenFields);
      if (nextHidden) next[key] = true;
      else delete next[key];
      return next;
    });
    onUpdateFieldLocks?.((locks) => {
      const next = normalizeTrackerFieldLocks(locks);
      if (nextHidden) next[key] = true;
      else delete next[key];
      return next;
    });
    if (nextHidden) onUpdate({ ...character, [field]: field === "mood" ? "" : null });
  };
  const fields = [
    {
      accessibleLabel: "Mood",
      icon: <HeartPulse size="0.75rem" />,
      key: "mood",
      onSave: onUpdate ? (mood: string) => onUpdate({ ...character, mood }) : undefined,
      placeholder: "Mood",
      hidden: fieldHidden("mood"),
      show: !!(character.mood || onUpdate) && (!fieldHidden("mood") || hideMode),
      tone: "mood" as const,
      value: character.mood,
    },
    {
      accessibleLabel: "Look",
      icon: <Eye size="0.75rem" />,
      key: "appearance",
      onSave: onUpdate ? (appearance: string) => onUpdate({ ...character, appearance: appearance || null }) : undefined,
      placeholder: "Appearance",
      hidden: fieldHidden("appearance"),
      show: !!(character.appearance || onUpdate) && (!fieldHidden("appearance") || hideMode),
      tone: "appearance" as const,
      value: character.appearance,
    },
    {
      accessibleLabel: "Outfit",
      icon: <Shirt size="0.75rem" />,
      key: "outfit",
      onSave: onUpdate ? (outfit: string) => onUpdate({ ...character, outfit: outfit || null }) : undefined,
      placeholder: "Outfit",
      hidden: fieldHidden("outfit"),
      show: !!(character.outfit || onUpdate) && (!fieldHidden("outfit") || hideMode),
      tone: "outfit" as const,
      value: character.outfit,
    },
  ].filter((field) => field.show);
  if (fields.length === 0) return null;
  const fieldSizeProfile = readableRows ? sizeProfile : "compact";

  return (
    <div className={FEATURED_FIELD_LIST_CLASS} style={{ gridTemplateRows: `repeat(${fields.length}, minmax(0, 1fr))` }}>
      {fields.map((field) => (
        <FeaturedFieldTile
          key={field.key}
          icon={field.icon}
          accessibleLabel={field.accessibleLabel}
          value={field.value}
          placeholder={field.placeholder}
          onSave={field.onSave}
          readable={readableRows || field.key !== "mood"}
          sizeProfile={fieldSizeProfile}
          tone={field.tone}
          lockKey={characterTrackerLockKey(character, characterIndex, field.key as FeaturedCharacterFieldKey)}
          hidden={field.hidden}
          hideMode={hideMode}
          onToggleHidden={onUpdate ? () => toggleFieldHidden(field.key as FeaturedCharacterFieldKey) : undefined}
        />
      ))}
    </div>
  );
}

export function FeaturedStatGrid({
  stats,
  onUpdate,
  onAdd,
  deleteMode,
  addMode,
  density,
  scrollable,
  wideColumns,
  className,
  getLockKey,
}: {
  stats: CharacterStat[];
  onUpdate?: (stats: CharacterStat[]) => void;
  onAdd?: () => void;
  deleteMode: boolean;
  addMode: boolean;
  density: TrackerStatDensity;
  scrollable: boolean;
  wideColumns?: boolean;
  className?: string;
  getLockKey?: (index: number, field: "name" | "value" | "max", stat: CharacterStat) => string;
}) {
  return (
    <div className={cn(FEATURED_STAT_SHELF_CLASS, scrollable ? "overflow-y-auto" : "overflow-y-hidden", className)}>
      <div className="relative z-[2]">
        <StatList
          stats={stats}
          onUpdate={onUpdate}
          onAdd={onAdd}
          deleteMode={deleteMode}
          addMode={addMode}
          nameMode="truncate"
          density={density}
          fillAvailable={false}
          wideColumns={wideColumns}
          showWideColumnGhost={wideColumns}
          visualTone="instrument"
          getLockKey={getLockKey}
        />
      </div>
    </div>
  );
}
