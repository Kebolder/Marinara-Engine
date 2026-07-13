// ──────────────────────────────────────────────
// Checkbox panel that configures which sources the AI-write "about me" draws
// from. Shared by the character-card editor and the in-chat about-me popout.
// ──────────────────────────────────────────────
import { useState } from "react";
import type { AboutMeSourceConfig } from "@marinara-engine/shared";
import { DEFAULT_ABOUT_ME_CHAT_CONTEXT_LIMIT } from "@marinara-engine/shared";
import { HelpTooltip } from "../ui/HelpTooltip";

const CARD_FIELDS: Array<{ key: keyof AboutMeSourceConfig; label: string }> = [
  { key: "description", label: "Description" },
  { key: "personality", label: "Personality" },
  { key: "scenario", label: "Scenario" },
  { key: "backstory", label: "Backstory" },
  { key: "appearance", label: "Appearance" },
];

function SourceRow({
  label,
  checked,
  disabled,
  tooltip,
  tooltipOpenSignal,
  onToggle,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  tooltip?: string;
  tooltipOpenSignal?: number;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <label
      className={
        "flex items-center gap-2 text-xs " +
        (disabled ? "cursor-not-allowed text-[var(--muted-foreground)]/50" : "text-[var(--foreground)]")
      }
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-3.5 w-3.5 shrink-0 accent-[var(--primary)] disabled:opacity-50"
      />
      <span className="inline-flex items-center gap-1">
        {label}
        {tooltip && <HelpTooltip text={tooltip} openSignal={tooltipOpenSignal} />}
      </span>
    </label>
  );
}

export function AboutMeSourcePicker({
  value,
  onChange,
  /** In-chat (chat-specific about me) enables the chat-context source; the card editor doesn't. */
  allowChatContext,
  /** The character's linked lorebook entries (card editor only) — enables per-entry selection.
   *  Undefined means the caller (e.g. the chat popout) can't select entries here. */
  lorebookEntries,
}: {
  value: AboutMeSourceConfig;
  onChange: (next: AboutMeSourceConfig) => void;
  allowChatContext: boolean;
  lorebookEntries?: Array<{ id: string; name: string }>;
}) {
  const toggle = (key: keyof AboutMeSourceConfig, checked: boolean) => onChange({ ...value, [key]: checked });
  const [chatContextLimitText, setChatContextLimitText] = useState<string | null>(null);

  // Per-entry selection: absent `lorebookEntryIds` means "all". First toggle materializes
  // the full list so unchecking one keeps the rest.
  const allEntryIds = (lorebookEntries ?? []).map((e) => e.id);
  const selectedEntryIds = value.lorebookEntryIds ?? allEntryIds;
  const toggleEntry = (entryId: string, checked: boolean) => {
    const base = value.lorebookEntryIds ?? allEntryIds;
    const next = checked ? Array.from(new Set([...base, entryId])) : base.filter((x) => x !== entryId);
    onChange({ ...value, lorebookEntryIds: next });
  };
  const lorebookTooltip = lorebookEntries
    ? "This character's lorebook entries — handy when the card fields are blank and the substance lives in the lorebook. Pick which entries below."
    : "This character's lorebook entries. To choose which entries feed the bio, open this character's card → Convo → About Me.";

  // The chat popout has no entry expansion — auto-open the explainer tooltip when the
  // user selects the Lorebook source there (desktop and mobile), so they learn entry
  // selection lives in the card editor. The card editor shows the expansion instead.
  const [lorebookTipSignal, setLorebookTipSignal] = useState(0);
  const toggleLorebook = (checked: boolean) => {
    toggle("lorebook", checked);
    if (checked && lorebookEntries === undefined) {
      setLorebookTipSignal((n) => n + 1);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--background)]/60 p-3">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        AI Write draws from
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {CARD_FIELDS.map((f) => (
          <SourceRow key={f.key} label={f.label} checked={!!value[f.key]} onToggle={(c) => toggle(f.key, c)} />
        ))}
      </div>
      <div className="space-y-1.5 border-t border-[var(--border)] pt-2">
        <SourceRow
          label="Convo behavior"
          checked={!!value.convoBehavior}
          onToggle={(c) => toggle("convoBehavior", c)}
        />
        <SourceRow
          label="Lorebook entries"
          checked={!!value.lorebook}
          onToggle={toggleLorebook}
          tooltip={lorebookTooltip}
          tooltipOpenSignal={lorebookTipSignal}
        />
        {/* Card editor only: pick which entries feed the bio. */}
        {lorebookEntries !== undefined && value.lorebook && (
          <div className="ml-5 max-h-40 space-y-1 overflow-y-auto border-l border-[var(--border)] pl-2">
            {lorebookEntries.length === 0 ? (
              <p className="text-[0.6875rem] text-[var(--muted-foreground)]/70">No lorebook entries.</p>
            ) : (
              lorebookEntries.map((e) => (
                <SourceRow
                  key={e.id}
                  label={e.name}
                  checked={selectedEntryIds.includes(e.id)}
                  onToggle={(c) => toggleEntry(e.id, c)}
                />
              ))
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <SourceRow
            label="Chat context"
            checked={!!value.chatContext}
            disabled={!allowChatContext}
            onToggle={(c) => toggle("chatContext", c)}
            tooltip={
              allowChatContext
                ? "Include recent messages from this chat so the bio reflects how they've been acting here."
                : "Only works for a chat-specific about me (edited from within a chat). The card editor has no chat to read."
            }
          />
          {allowChatContext && value.chatContext && (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
              <input
                type="number"
                min={1}
                max={200}
                aria-label="Chat context message limit"
                value={chatContextLimitText ?? (value.chatContextLimit ?? DEFAULT_ABOUT_ME_CHAT_CONTEXT_LIMIT)}
                onChange={(e) => {
                  // Empty (mid-edit) clears to the default; only clamp real numbers, so
                  // clearing the field to retype doesn't snap it to 1 (Number("") === 0).
                  const raw = e.target.value;
                  setChatContextLimitText(raw);
                  if (raw === "") {
                    onChange({ ...value, chatContextLimit: undefined });
                    return;
                  }
                  const n = Number(raw);
                  onChange({
                    ...value,
                    chatContextLimit: Number.isFinite(n)
                      ? Math.max(1, Math.min(200, Math.round(n)))
                      : value.chatContextLimit,
                  });
                }}
                onBlur={() => setChatContextLimitText(null)}
                className="w-14 rounded-md border border-[var(--border)] bg-[var(--secondary)] px-1.5 py-0.5 text-xs outline-none focus:border-[var(--primary)]/40"
              />
              msgs
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
