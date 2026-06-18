// ──────────────────────────────────────────────
// Custom Emoji tab — the EmojiPicker's "Custom" panel (Conversation mode).
// Lists global custom emojis (click → insert :name:), uploads new ones, and
// (in edit mode) renames/deletes them. Rendered into EmojiPicker via its
// optional `customTab` slot so the picker itself stays generic.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, Settings, Trash2 } from "lucide-react";
import {
  useCustomEmojis,
  useUploadCustomEmoji,
  useRenameCustomEmoji,
  useDeleteCustomEmoji,
} from "../../hooks/use-custom-emojis";
import { useConversationCustomEmojis, type ConversationCustomEmoji } from "../../hooks/use-conversation-custom-emojis";
import { useChat, useUpdateChatMetadata } from "../../hooks/use-chats";
import { useConnections } from "../../hooks/use-connections";
import { useChatStore } from "../../stores/chat.store";
import { parseChatMetadata } from "../../lib/chat-display";
import { readImageDimensions, validateDimensionsForKind, slugifyCustomName } from "../../lib/custom-emoji";
import {
  normalizeCustomEmojiSelection,
  CUSTOM_EMOJI_SELECTION_MIN_COUNT,
  CUSTOM_EMOJI_SELECTION_MAX_COUNT,
  type CustomEmojiSelectionPrefs,
} from "@marinara-engine/shared";
import { showPromptDialog, showConfirmDialog } from "../../lib/app-dialogs";
import { cn } from "../../lib/utils";

export function CustomEmojiTab({ onInsert, query }: { onInsert: (token: string) => void; query: string }) {
  const { data: emojis } = useCustomEmojis();
  const upload = useUploadCustomEmoji();
  const rename = useRenameCustomEmoji();
  const remove = useDeleteCustomEmoji();
  const { list: conversationEmojis } = useConversationCustomEmojis();
  const activeChatId = useChatStore((s) => s.activeChatId);
  const { data: activeChat } = useChat(activeChatId);
  const updateMeta = useUpdateChatMetadata();
  const { data: connections } = useConnections();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectionPrefs = normalizeCustomEmojiSelection(parseChatMetadata(activeChat?.metadata).customEmojiSelection);
  const [maxCountDraft, setMaxCountDraft] = useState(selectionPrefs.maxCount);
  useEffect(() => setMaxCountDraft(selectionPrefs.maxCount), [selectionPrefs.maxCount]);

  const saveSelectionPrefs = useCallback(
    (patch: Partial<CustomEmojiSelectionPrefs>) => {
      if (!activeChatId) return;
      updateMeta.mutate({ id: activeChatId, customEmojiSelection: { ...selectionPrefs, ...patch } });
    },
    [activeChatId, selectionPrefs, updateMeta],
  );

  const list = emojis ?? [];

  // Persona/character gallery emojis, grouped by source — read-only here (managed in their galleries).
  const bySource = new Map<string, ConversationCustomEmoji[]>();
  for (const emoji of conversationEmojis) {
    if (emoji.source === "Global") continue;
    const existing = bySource.get(emoji.source);
    if (existing) existing.push(emoji);
    else bySource.set(emoji.source, [emoji]);
  }
  const sourceGroups = [...bySource.entries()];

  // Search filter (by emoji name) over the global pool and each source group.
  const q = query.trim().toLowerCase();
  const filteredGlobal = q ? list.filter((emoji) => emoji.name.toLowerCase().includes(q)) : list;
  const filteredGroups: [string, ConversationCustomEmoji[]][] = q
    ? sourceGroups
        .map(
          ([source, emojis]) =>
            [source, emojis.filter((emoji) => emoji.name.toLowerCase().includes(q))] as [
              string,
              ConversationCustomEmoji[],
            ],
        )
        .filter(([, emojis]) => emojis.length > 0)
    : sourceGroups;

  const handleFiles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length === 0) return;
      setError(null);

      // Name and upload each file one at a time, previewing the image in the name dialog.
      for (const file of files) {
        const objectUrl = URL.createObjectURL(file);
        try {
          const { width, height } = await readImageDimensions(objectUrl);
          const valid = validateDimensionsForKind(width, height, "emoji");
          if (!valid.ok) {
            setError(valid.reason);
            continue;
          }
          const suggested = slugifyCustomName(file.name.replace(/\.[^.]+$/, ""));
          const raw = await showPromptDialog({
            title: "Name this emoji",
            message: "Use it in messages as :name: — lowercase letters, numbers, and underscores.",
            defaultValue: suggested,
            placeholder: "e.g. kekw",
            confirmLabel: "Add",
            previewImageUrl: objectUrl,
          });
          if (raw == null) continue; // skipped this one — keep going through the rest
          const name = slugifyCustomName(raw);
          if (!name) {
            setError("Enter a valid name (letters, numbers, or underscores).");
            continue;
          }
          await upload.mutateAsync({ file, name, width, height });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to add emoji.");
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
    },
    [upload],
  );

  const handleRename = useCallback(
    async (id: string, current: string) => {
      const raw = await showPromptDialog({
        title: "Rename emoji",
        message: "New name (used as :name:).",
        defaultValue: current,
        confirmLabel: "Rename",
      });
      if (raw == null) return;
      const name = slugifyCustomName(raw);
      if (!name || name === current) return;
      rename.mutate({ id, name });
    },
    [rename],
  );

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      if (
        await showConfirmDialog({
          title: "Delete emoji",
          message: `Delete :${name}:? Messages that already used it will show the text instead.`,
          confirmLabel: "Delete",
          tone: "destructive",
        })
      ) {
        remove.mutate(id);
      }
    },
    [remove],
  );

  return (
    <div className="px-1">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground/5 px-2 py-1 text-xs text-foreground/70 ring-1 ring-foreground/10 transition-colors hover:bg-foreground/10 hover:text-foreground/90"
        >
          <ImagePlus size="0.875rem" /> Upload
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            title="Selection preferences"
            aria-label="Selection preferences"
            className={cn(
              "flex items-center rounded-md px-1.5 py-1 text-xs transition-colors",
              showSettings
                ? "bg-foreground/10 text-foreground/80 ring-1 ring-foreground/15"
                : "text-foreground/45 hover:bg-foreground/10 hover:text-foreground/70",
            )}
          >
            <Settings size="0.875rem" />
          </button>
          {list.length > 0 && (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className={cn(
                "rounded-md px-2 py-1 text-xs transition-colors",
                editing
                  ? "bg-foreground/10 text-foreground/80 ring-1 ring-foreground/15"
                  : "text-foreground/45 hover:bg-foreground/10 hover:text-foreground/70",
              )}
            >
              {editing ? "Done" : "Edit"}
            </button>
          )}
        </div>
      </div>

      {showSettings && (
        <div className="mb-2 rounded-md bg-foreground/5 p-2 ring-1 ring-foreground/10">
          <p className="mb-1.5 text-[0.6875rem] text-foreground/55">
            When a character has more custom emojis than the max, how should the ones offered to the model be chosen?
          </p>
          <div className="mb-1.5 flex items-center gap-1">
            {(["semantic", "random", "tool-call"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => saveSelectionPrefs({ mode })}
                className={cn(
                  "flex-1 rounded px-2 py-1 text-xs capitalize transition-colors",
                  selectionPrefs.mode === mode
                    ? "bg-[var(--primary)] text-white"
                    : "bg-foreground/5 text-foreground/60 ring-1 ring-foreground/10 hover:bg-foreground/10",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          <p className="mb-2 text-[0.625rem] text-foreground/40">
            {selectionPrefs.mode === "semantic"
              ? "Offers the emojis most relevant to the recent conversation (falls back to random if the local embedder is unavailable)."
              : selectionPrefs.mode === "random"
                ? "Offers a random set for each reply."
                : "A model call picks the fitting emojis each reply — choose a capable connection below. Falls back to semantic if it's unset or fails."}
          </p>
          {selectionPrefs.mode === "tool-call" && (
            <div className="mb-2">
              <select
                value={selectionPrefs.toolConnectionId ?? ""}
                onChange={(e) => saveSelectionPrefs({ toolConnectionId: e.target.value || null })}
                className="w-full rounded bg-foreground/5 px-2 py-1 text-xs text-foreground ring-1 ring-foreground/10 focus:outline-none focus:ring-[var(--primary)]"
              >
                <option value="">Select a connection…</option>
                {((connections ?? []) as Array<{ id: string; name?: string }>).map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name || connection.id}
                  </option>
                ))}
              </select>
              {!selectionPrefs.toolConnectionId && (
                <p className="mt-1 text-[0.625rem] text-amber-400/80">
                  No connection set — this falls back to semantic selection.
                </p>
              )}
            </div>
          )}
          <label className="flex items-center justify-between gap-2 text-xs text-foreground/60">
            <span>Max emojis offered</span>
            <input
              type="number"
              min={CUSTOM_EMOJI_SELECTION_MIN_COUNT}
              max={CUSTOM_EMOJI_SELECTION_MAX_COUNT}
              value={maxCountDraft}
              onChange={(e) => setMaxCountDraft(Number(e.target.value))}
              onBlur={() => saveSelectionPrefs({ maxCount: maxCountDraft })}
              className="w-16 rounded bg-foreground/5 px-2 py-1 text-right text-foreground ring-1 ring-foreground/10 focus:outline-none focus:ring-[var(--primary)]"
            />
          </label>
        </div>
      )}

      {error && <p className="mb-2 px-1 text-[0.6875rem] text-red-400">{error}</p>}

      {filteredGlobal.length === 0 && filteredGroups.length === 0 ? (
        <p className="px-1 py-6 text-center text-[0.6875rem] text-foreground/45">
          {q ? (
            <>No custom emojis match “{query.trim()}”.</>
          ) : (
            <>
              No custom emojis yet. Upload one (max 256×256) to use it as <span className="font-mono">:name:</span>.
            </>
          )}
        </p>
      ) : (
        <>
          {filteredGlobal.length > 0 && (
            <>
              {filteredGroups.length > 0 && (
                <p className="mb-1 px-1 text-[0.625rem] font-semibold uppercase tracking-wide text-foreground/40">
                  Global
                </p>
              )}
              <div className="grid grid-cols-6 gap-1">
                {filteredGlobal.map((emoji) => (
                  <div key={emoji.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => (editing ? void handleRename(emoji.id, emoji.name) : onInsert(`:${emoji.name}:`))}
                      title={editing ? `Rename :${emoji.name}:` : `:${emoji.name}:`}
                      className="flex aspect-square w-full items-center justify-center rounded-md p-1 transition-transform hover:scale-110 hover:bg-foreground/10 active:scale-100"
                    >
                      <img src={emoji.url} alt={`:${emoji.name}:`} className="max-h-9 max-w-full object-contain" />
                    </button>
                    {editing && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(emoji.id, emoji.name)}
                        title={`Delete :${emoji.name}:`}
                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--destructive)] text-white shadow ring-1 ring-black/10 transition-transform hover:scale-110"
                      >
                        <Trash2 size="0.625rem" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {filteredGroups.map(([source, sourceEmojis]) => (
            <div key={source} className="mt-2">
              <p className="mb-1 px-1 text-[0.625rem] font-semibold uppercase tracking-wide text-foreground/40">
                {source}
              </p>
              <div className="grid grid-cols-6 gap-1">
                {sourceEmojis.map((emoji) => (
                  <div key={emoji.name} className="group relative">
                    <button
                      type="button"
                      onClick={() => onInsert(`:${emoji.name}:`)}
                      title={`:${emoji.name}: — ${source}`}
                      className="flex aspect-square w-full items-center justify-center rounded-md p-1 transition-transform hover:scale-110 hover:bg-foreground/10 active:scale-100"
                    >
                      <img src={emoji.url} alt={`:${emoji.name}:`} className="max-h-9 max-w-full object-contain" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
