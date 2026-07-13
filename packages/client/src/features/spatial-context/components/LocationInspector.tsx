import { useMemo, useState, type ReactNode } from "react";
import { Archive, Link2, MapPin, Plus, Trash2 } from "lucide-react";
import type {
  SpatialContextDefinition,
  SpatialDefinitionIssue,
  SpatialLocation,
  SpatialLocationKind,
  SpatialLinkState,
} from "@marinara-engine/shared";
import { cn } from "../../../lib/utils";
import { getSpatialDescendantIds } from "../editor-state";

const INPUT_CLASS =
  "w-full rounded-lg border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--marinara-chat-chrome-panel-text)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--marinara-chat-chrome-panel-muted)] focus:border-[var(--marinara-chat-chrome-button-border-active)] focus:ring-2 focus:ring-[var(--marinara-chat-chrome-focus-ring)]";

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--marinara-chat-chrome-panel-title)]">
        {label}
        {hint && (
          <span className="text-[0.625rem] font-normal text-[var(--marinara-chat-chrome-panel-muted)]">{hint}</span>
        )}
      </span>
      {children}
      {error && <span className="block text-[0.6875rem] text-red-400">{error}</span>}
    </label>
  );
}

interface LocationInspectorProps {
  definition: SpatialContextDefinition;
  location: SpatialLocation | null;
  issues: SpatialDefinitionIssue[];
  currentLocationId: string | null;
  onUpdate: (patch: Partial<SpatialLocation>) => void;
  onReparent: (parentId: string | null) => void;
  onSetStarting: () => void;
  onArchive: () => void;
}

export function LocationInspector({
  definition,
  location,
  issues,
  currentLocationId,
  onUpdate,
  onReparent,
  onSetStarting,
  onArchive,
}: LocationInspectorProps) {
  const [newLinkTarget, setNewLinkTarget] = useState("");
  const descendants = useMemo(
    () => (location ? getSpatialDescendantIds(definition, location.id) : new Set<string>()),
    [definition, location],
  );
  const eligibleParents = definition.locations
    .filter((candidate) => candidate.id !== location?.id && !descendants.has(candidate.id))
    .sort((left, right) => left.name.localeCompare(right.name));
  const eligibleLinks = definition.locations
    .filter(
      (candidate) =>
        candidate.id !== location?.id && location?.links.every((existing) => existing.targetId !== candidate.id),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  if (!location) {
    return (
      <section className="flex h-full items-center justify-center px-6 text-center" aria-label="Location details">
        <div>
          <MapPin className="mx-auto mb-3 text-[var(--marinara-chat-chrome-panel-muted)]" size="1.25rem" />
          <h2 className="text-sm font-semibold text-[var(--marinara-chat-chrome-panel-title)]">Select a location</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--marinara-chat-chrome-panel-muted)]">
            Preview a location here, then use Enter to navigate into it.
          </p>
        </div>
      </section>
    );
  }

  const issueFor = (field: string) => issues.find((issue) => issue.path.at(-1) === field)?.message;
  const updateLink = (index: number, patch: Partial<SpatialLocation["links"][number]>) => {
    onUpdate({ links: location.links.map((link, linkIndex) => (index === linkIndex ? { ...link, ...patch } : link)) });
  };
  const removeLink = (index: number) =>
    onUpdate({ links: location.links.filter((_, linkIndex) => linkIndex !== index) });
  const addLink = () => {
    if (!newLinkTarget) return;
    onUpdate({
      links: [...location.links, { targetId: newLinkTarget, bidirectional: false, state: "available" }],
    });
    setNewLinkTarget("");
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={`Details for ${location.name}`}>
      <div className="border-b border-[var(--marinara-chat-chrome-panel-divider)] px-4 py-3">
        <div className="flex items-center gap-2">
          <MapPin size="0.875rem" className="text-[var(--marinara-chat-chrome-accent)]" />
          <h2 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-[var(--marinara-chat-chrome-panel-title)]">
            Location details
          </h2>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[0.625rem] font-medium",
              location.status === "active" ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-500/15 text-slate-400",
            )}
          >
            {location.status}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {issues.length > 0 && (
          <div
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
            role="alert"
          >
            <p className="font-semibold">This location needs attention</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}

        <Field label="Name" error={issueFor("name")}>
          <input
            className={INPUT_CLASS}
            value={location.name}
            onChange={(event) => onUpdate({ name: event.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <select
              className={INPUT_CLASS}
              value={location.kind}
              onChange={(event) => onUpdate({ kind: event.target.value as SpatialLocationKind })}
            >
              {(["region", "settlement", "place", "building", "floor", "room"] as const).map((kind) => (
                <option key={kind} value={kind}>
                  {kind[0].toUpperCase() + kind.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Icon" hint="Emoji or symbol">
            <input
              className={INPUT_CLASS}
              value={location.icon ?? ""}
              maxLength={64}
              placeholder="⌖"
              onChange={(event) => onUpdate({ icon: event.target.value || undefined })}
            />
          </Field>
        </div>

        <Field label="Public description" hint="Shown in location context" error={issueFor("description")}>
          <textarea
            className={`${INPUT_CLASS} min-h-24 resize-y`}
            value={location.description}
            onChange={(event) => onUpdate({ description: event.target.value })}
          />
        </Field>

        <Field label="Private model memory" hint="AI only" error={issueFor("modelMemory")}>
          <textarea
            className={`${INPUT_CLASS} min-h-28 resize-y`}
            value={location.modelMemory ?? ""}
            placeholder="Facts the model should remember only while this location is active"
            onChange={(event) => onUpdate({ modelMemory: event.target.value || undefined })}
          />
        </Field>

        <Field label="Awareness summary" hint="Short orientation cue" error={issueFor("awarenessSummary")}>
          <textarea
            className={`${INPUT_CLASS} min-h-20 resize-y`}
            value={location.awarenessSummary ?? ""}
            onChange={(event) => onUpdate({ awarenessSummary: event.target.value || undefined })}
          />
        </Field>

        <div className="border-t border-[var(--marinara-chat-chrome-panel-divider)] pt-4">
          <h3 className="mb-3 text-xs font-semibold text-[var(--marinara-chat-chrome-panel-title)]">
            Hierarchy and display
          </h3>
          <div className="space-y-3">
            <Field label="Parent" error={issueFor("parentId")}>
              <select
                className={INPUT_CLASS}
                value={location.parentId ?? ""}
                onChange={(event) => onReparent(event.target.value || null)}
              >
                <option value="">Top level</option>
                {eligibleParents.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name || "Untitled location"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Child presentation">
              <select
                className={INPUT_CLASS}
                value={location.childPresentation}
                onChange={(event) =>
                  onUpdate({ childPresentation: event.target.value as SpatialLocation["childPresentation"] })
                }
              >
                <option value="list">List</option>
                <option value="map">Map</option>
                <option value="layers">Layers</option>
              </select>
            </Field>
            {location.placement && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Map X" hint="0 to 100" error={issueFor("x")}>
                  <input
                    className={INPUT_CLASS}
                    type="number"
                    min={0}
                    max={100}
                    value={location.placement.x}
                    onChange={(event) =>
                      onUpdate({ placement: { ...location.placement!, x: Number(event.target.value) } })
                    }
                  />
                </Field>
                <Field label="Map Y" hint="0 to 100" error={issueFor("y")}>
                  <input
                    className={INPUT_CLASS}
                    type="number"
                    min={0}
                    max={100}
                    value={location.placement.y}
                    onChange={(event) =>
                      onUpdate({ placement: { ...location.placement!, y: Number(event.target.value) } })
                    }
                  />
                </Field>
              </div>
            )}
            {location.layerOrder !== undefined && (
              <Field label="Layer order" error={issueFor("layerOrder")}>
                <input
                  className={INPUT_CLASS}
                  type="number"
                  value={location.layerOrder}
                  onChange={(event) => onUpdate({ layerOrder: Number(event.target.value) })}
                />
              </Field>
            )}
          </div>
        </div>

        <div className="border-t border-[var(--marinara-chat-chrome-panel-divider)] pt-4">
          <div className="mb-3 flex items-center gap-2">
            <Link2 size="0.8125rem" className="text-[var(--marinara-chat-chrome-accent)]" />
            <h3 className="text-xs font-semibold text-[var(--marinara-chat-chrome-panel-title)]">Direct links</h3>
          </div>
          <div className="space-y-2">
            {location.links.map((link, index) => {
              const target = definition.locations.find((candidate) => candidate.id === link.targetId);
              return (
                <div
                  key={`${link.targetId}-${index}`}
                  className="rounded-lg border border-[var(--marinara-chat-chrome-panel-border)] p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {target?.name ?? "Missing location"}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeLink(index)}
                      aria-label={`Remove link to ${target?.name ?? "missing location"}`}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--marinara-chat-chrome-panel-muted)] hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash2 size="0.75rem" />
                    </button>
                  </div>
                  <input
                    className={`${INPUT_CLASS} mt-2`}
                    value={link.label ?? ""}
                    placeholder="Optional direction label"
                    onChange={(event) => updateLink(index, { label: event.target.value || undefined })}
                  />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <select
                      className={INPUT_CLASS}
                      value={link.state}
                      aria-label="Link state"
                      onChange={(event) => updateLink(index, { state: event.target.value as SpatialLinkState })}
                    >
                      <option value="available">Available</option>
                      <option value="hidden">Hidden</option>
                      <option value="blocked">Blocked</option>
                    </select>
                    <label className="flex min-h-11 items-center gap-2 rounded-lg border border-[var(--marinara-chat-chrome-panel-border)] px-3 text-xs">
                      <input
                        type="checkbox"
                        checked={link.bidirectional}
                        onChange={(event) => updateLink(index, { bidirectional: event.target.checked })}
                      />
                      Both ways
                    </label>
                  </div>
                </div>
              );
            })}
            <div className="flex gap-2">
              <select
                className={`${INPUT_CLASS} min-w-0 flex-1`}
                value={newLinkTarget}
                onChange={(event) => setNewLinkTarget(event.target.value)}
              >
                <option value="">Choose location</option>
                {eligibleLinks.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name || "Untitled location"}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!newLinkTarget}
                onClick={addLink}
                className="mari-chrome-control min-h-11 px-3 text-xs"
              >
                <Plus size="0.75rem" /> Link
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--marinara-chat-chrome-panel-divider)] pt-4">
          <h3 className="mb-3 text-xs font-semibold text-[var(--marinara-chat-chrome-panel-title)]">Location status</h3>
          <div className="space-y-2">
            <button
              type="button"
              onClick={onSetStarting}
              disabled={location.status !== "active" || definition.startingLocationId === location.id}
              className="mari-chrome-control min-h-11 w-full justify-start px-3 text-xs"
            >
              <MapPin size="0.75rem" />
              {definition.startingLocationId === location.id ? "Starting location" : "Set as starting location"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (location.status === "archived") onUpdate({ status: "active" });
                else onArchive();
              }}
              className={cn(
                "mari-chrome-control min-h-11 w-full justify-start px-3 text-xs",
                location.status === "active" && "mari-chrome-control--danger",
              )}
            >
              <Archive size="0.75rem" />
              {location.status === "archived" ? "Restore location" : "Archive location"}
            </button>
            {currentLocationId === location.id && (
              <p className="text-[0.6875rem] leading-relaxed text-amber-400">
                This is the current runtime location. Choose a replacement before saving an archive.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
