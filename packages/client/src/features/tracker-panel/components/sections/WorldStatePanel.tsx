import { type ReactNode } from "react";
import { MapPin, X } from "lucide-react";
import {
  DEFAULT_WORLD_CUSTOM_FIELD_ICON,
  removeTrackerFieldLockPrefix,
  renameTrackerFieldLockPrefix,
  worldCustomFieldTrackerLockKey,
  worldCustomFieldTrackerLockPrefix,
  worldTrackerLockKey,
  type GameState,
  type WorldCustomField,
} from "@marinara-engine/shared";
import type { GameStatePatchField } from "../../../../hooks/use-game-state-patcher";
import type { TrackerPanelSizeProfile, TrackerTemperatureUnit } from "../../../../stores/ui.store";
import { cn } from "../../../../lib/utils";
import {
  getWorldAmbienceStyle,
  getWorldDateDisplay,
  getWorldTimeDisplay,
  WORLD_FREEFORM_DATE_GRID_BASE_CLASS,
  WORLD_FREEFORM_DATE_GRID_PHRASE_TIME_CLASS,
  WORLD_GRID_BASE_CLASS,
  WORLD_GRID_PHRASE_TIME_CLASS,
} from "../../lib/world-state-display";
import { WorldCustomFieldIcon } from "../../lib/world-custom-field-icons";
import { InlineEdit } from "../controls/InlineControls";
import { AddRowButton, SectionHeader } from "../controls/SectionControls";
import { useTrackerFieldLock, useTrackerLockContext } from "../TrackerLockContext";
import { WorldDateTile, WorldTimeTile } from "./WorldDateTimeTiles";
import { WorldTileShell } from "./WorldEditableTile";
import { WorldForecastTile } from "./WorldForecastTile";
import { WorldLocationPlate } from "./WorldLocationPlate";

function makeUniqueWorldCustomFieldName(fields: WorldCustomField[]) {
  const names = new Set(fields.map((field) => normalizeCustomFieldName(field.name)).filter(Boolean));
  let index = 1;
  let name = "New Field";
  while (names.has(normalizeCustomFieldName(name))) {
    index += 1;
    name = `New Field ${index}`;
  }
  return name;
}

function normalizeCustomFieldName(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function WorldCustomFieldPlate({
  field,
  fieldIndex,
  className,
  addMode,
  deleteMode,
  onUpdate,
  onRemove,
  isNameTaken,
}: {
  field: WorldCustomField;
  fieldIndex: number;
  className?: string;
  addMode: boolean;
  deleteMode: boolean;
  onUpdate: (field: WorldCustomField) => void;
  onRemove: () => void;
  isNameTaken: (name: string) => boolean;
}) {
  const { fieldLocks, onUpdateFieldLocks } = useTrackerLockContext();
  const valueLockKey = worldCustomFieldTrackerLockKey(field, "value", fieldIndex);
  const valueLock = useTrackerFieldLock(valueLockKey);
  const name = field.name?.trim() || "Field";
  const valueText = field.value?.trim() || "Set value";
  const valueIsLong = valueText.length > 36 || valueText.includes(" ");
  const customPrefix = worldCustomFieldTrackerLockPrefix(field, fieldIndex);

  const updateName = (nextName: string) => {
    const trimmedName = nextName.trim() || "Field";
    if (trimmedName === name) return;
    if (isNameTaken(trimmedName)) return;
    const updated = { ...field, name: trimmedName };
    onUpdateFieldLocks?.((locks) =>
      renameTrackerFieldLockPrefix(locks, customPrefix, worldCustomFieldTrackerLockPrefix(updated, fieldIndex)),
    );
    onUpdate(updated);
  };

  return (
    <WorldTileShell label={name} className={cn("min-h-[2.75rem]", className)}>
      <div
        className={cn(
          "relative z-[1] grid h-full items-center gap-1 px-1 py-1 text-left @min-[380px]:px-1.5",
          "grid-cols-[1.7rem_minmax(2.6rem,0.42fr)_minmax(0,1fr)] @min-[380px]:grid-cols-[1.9rem_minmax(3rem,0.4fr)_minmax(0,1fr)]",
          deleteMode && "pr-7",
        )}
      >
        <div className="relative flex h-full min-h-[1.625rem] w-full items-center justify-center overflow-hidden rounded-[3px] bg-[color-mix(in_srgb,var(--background)_34%,transparent)] ring-1 ring-[var(--border)]/24 @min-[380px]:min-h-[1.8rem]">
          <div className="pointer-events-none absolute inset-0 opacity-[0.17] [background-image:radial-gradient(circle,color-mix(in_srgb,var(--foreground)_44%,transparent)_0.75px,transparent_1px)] [background-size:4px_4px]" />
          <WorldCustomFieldIcon icon={field.icon} className="relative z-[1]" />
        </div>
        {addMode && (
          <InlineEdit
            value={name}
            onSave={updateName}
            placeholder="Field"
            ariaLabel={`${name} field name`}
            className="min-w-0 px-0.5 py-0 text-[0.625rem] font-semibold uppercase text-[var(--muted-foreground)]/88"
            previewClassName="truncate"
            scrollOnHover
            showEditHint={false}
            locked={!!fieldLocks?.[worldCustomFieldTrackerLockKey(field, "name", fieldIndex)]}
            lockMode={false}
          />
        )}
        {!addMode && (
          <span
            className="min-w-0 truncate px-0.5 text-[0.625rem] font-semibold uppercase text-[var(--muted-foreground)]/88"
            title={name}
          >
            {name}
          </span>
        )}
        <InlineEdit
          value={field.value}
          onSave={(value) => onUpdate({ ...field, value })}
          placeholder="Set value"
          ariaLabel={`${name} value`}
          className={cn(
            "min-w-0 max-w-full pr-3 text-left font-bold text-[var(--foreground)]/92 drop-shadow-sm",
            valueIsLong ? "min-h-5 text-[0.625rem] leading-[0.75rem]" : "text-[0.75rem] leading-4",
          )}
          previewLineCount={valueIsLong ? 2 : undefined}
          scrollOnHover={!valueIsLong}
          previewClassName={valueIsLong ? "whitespace-normal break-words" : undefined}
          showEditHint={!deleteMode}
          {...valueLock}
        />
      </div>
      {deleteMode && (
        <button
          type="button"
          onClick={() => {
            onUpdateFieldLocks?.((locks) => removeTrackerFieldLockPrefix(locks, customPrefix));
            onRemove();
          }}
          title={`Remove ${name}`}
          aria-label={`Remove ${name}`}
          className="absolute right-1 top-1/2 z-[4] flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--background)]/85 text-[var(--destructive)] shadow-sm ring-1 ring-[var(--border)]/70 backdrop-blur-sm transition-all hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-[var(--border)] active:scale-90 [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6"
        >
          <X size="0.625rem" />
        </button>
      )}
    </WorldTileShell>
  );
}

export function WorldStatePanel({
  state,
  trackerPanelSizeProfile,
  trackerTemperatureUnit,
  action,
  onSaveField,
  deleteMode = false,
  addMode = false,
  collapsed = false,
  onToggleCollapsed,
}: {
  state: GameState | null;
  trackerPanelSizeProfile: TrackerPanelSizeProfile;
  trackerTemperatureUnit: TrackerTemperatureUnit;
  action?: ReactNode;
  onSaveField: (field: GameStatePatchField, value: unknown) => void;
  deleteMode?: boolean;
  addMode?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const worldCustomFields = Array.isArray(state?.worldCustomFields) ? state.worldCustomFields : [];
  const dateDisplay = getWorldDateDisplay(state?.date);
  const hasFreeformDate = dateDisplay.kind === "freeform";
  const hasPhraseTime = getWorldTimeDisplay(state?.time).kind === "phrase";
  const gridColumnsClass = hasFreeformDate
    ? hasPhraseTime
      ? WORLD_FREEFORM_DATE_GRID_PHRASE_TIME_CLASS
      : WORLD_FREEFORM_DATE_GRID_BASE_CLASS
    : hasPhraseTime
      ? WORLD_GRID_PHRASE_TIME_CLASS
      : WORLD_GRID_BASE_CLASS;

  return (
    <div
      className="relative z-10 overflow-hidden border-b border-[var(--border)] shadow-inner transition-colors duration-200"
      style={getWorldAmbienceStyle()}
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[var(--foreground)]/10" />

      <SectionHeader
        icon={<MapPin size="0.6875rem" />}
        title="World"
        action={action}
        addAction={
          addMode ? (
            <AddRowButton
              title="Add world field"
              onClick={() =>
                onSaveField("worldCustomFields", [
                  ...worldCustomFields,
                  {
                    name: makeUniqueWorldCustomFieldName(worldCustomFields),
                    value: "",
                    icon: DEFAULT_WORLD_CUSTOM_FIELD_ICON,
                  },
                ])
              }
              className="rounded-sm"
            />
          ) : undefined
        }
        collapsed={collapsed}
        onToggle={onToggleCollapsed}
      />

      {!collapsed && (
        <div className={cn("relative grid gap-0.5 p-1", gridColumnsClass)}>
          <WorldDateTile
            value={state?.date}
            display={dateDisplay}
            onSave={(value) => onSaveField("date", value || null)}
            lockKey={worldTrackerLockKey("date")}
          />
          <WorldTimeTile
            value={state?.time}
            onSave={(value) => onSaveField("time", value || null)}
            lockKey={worldTrackerLockKey("time")}
          />
          <WorldForecastTile
            weather={state?.weather}
            temperature={state?.temperature}
            trackerPanelSizeProfile={trackerPanelSizeProfile}
            trackerTemperatureUnit={trackerTemperatureUnit}
            onSaveWeather={(value) => onSaveField("weather", value || null)}
            onSaveTemperature={(value) => onSaveField("temperature", value || null)}
            weatherLockKey={worldTrackerLockKey("weather")}
            temperatureLockKey={worldTrackerLockKey("temperature")}
          />
          <WorldLocationPlate
            value={state?.location}
            onSave={(value) => onSaveField("location", value || null)}
            className="col-span-full"
            lockKey={worldTrackerLockKey("location")}
          />
          {worldCustomFields.map((field, index) => (
            <WorldCustomFieldPlate
              key={`${field.name}-${index}`}
              field={field}
              fieldIndex={index}
              className="col-span-full"
              addMode={addMode}
              deleteMode={deleteMode}
              onUpdate={(updated) => {
                const next = [...worldCustomFields];
                next[index] = updated;
                onSaveField("worldCustomFields", next);
              }}
              onRemove={() =>
                onSaveField(
                  "worldCustomFields",
                  worldCustomFields.filter((_, fieldIndex) => fieldIndex !== index),
                )
              }
              isNameTaken={(candidate) =>
                worldCustomFields.some(
                  (otherField, otherIndex) =>
                    otherIndex !== index &&
                    normalizeCustomFieldName(otherField.name) === normalizeCustomFieldName(candidate),
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
