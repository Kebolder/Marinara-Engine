// ──────────────────────────────────────────────
// About Me profile popout (Conversation mode) — opened by clicking an avatar.
// A Discord-style card anchored next to the avatar (no dimmed backdrop): blown-up
// avatar + status, then the effective about-me (per-chat override, else the
// card/persona default), with set / edit / clear of the chat-specific override.
// ──────────────────────────────────────────────
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, RotateCcw, Save, Smile, Trash2, User, X } from "lucide-react";
import { toast } from "sonner";
import type { Chat } from "@marinara-engine/shared";
import { useChat, useUpdateChatMetadata } from "../../hooks/use-chats";
import { useCharacter, usePersonas } from "../../hooks/use-characters";
import { useConversationCustomEmojis } from "../../hooks/use-conversation-custom-emojis";
import { useChatStore } from "../../stores/chat.store";
import { cn } from "../../lib/utils";
import { renderInlineWithCustomEmojis } from "../../lib/custom-emoji-render";
import { EmojiPicker } from "../ui/EmojiPicker";
import { CustomEmojiTab } from "../chat/CustomEmojiTab";

interface AnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface AboutMeViewerModalProps {
  open: boolean;
  onClose: () => void;
  kind: "character" | "persona";
  id: string;
  anchorRect?: AnchorRect | null;
  avatarUrl?: string | null;
  displayName?: string | null;
  nameColor?: string | null;
  status?: "online" | "idle" | "dnd" | "offline" | null;
  activity?: string | null;
}

const CARD_WIDTH = 320;

function statusDotClass(status?: string | null) {
  return status === "offline"
    ? "bg-gray-400"
    : status === "dnd"
      ? "bg-red-500"
      : status === "idle"
        ? "bg-yellow-500"
        : "bg-green-500";
}

function statusLabel(status?: string | null) {
  return status === "offline" ? "Offline" : status === "dnd" ? "Busy" : status === "idle" ? "Away" : "Online";
}

/** Style for a name that may be a solid color or a CSS gradient string. */
function nameStyle(nameColor?: string | null) {
  if (!nameColor) return undefined;
  if (nameColor.includes("gradient")) {
    return {
      backgroundImage: nameColor,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
    } as const;
  }
  return { color: nameColor } as const;
}

function parseCharacterConvo(data: unknown): { name: string; displayName: string; aboutMe: string } {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = (typeof data === "string" ? JSON.parse(data) : data) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  const ext = (parsed?.extensions ?? {}) as Record<string, unknown>;
  const name = typeof parsed?.name === "string" ? parsed.name : "";
  const displayName = typeof ext.convoDisplayName === "string" && ext.convoDisplayName ? ext.convoDisplayName : name;
  return { name, displayName, aboutMe: typeof ext.aboutMe === "string" ? ext.aboutMe : "" };
}

export function AboutMeViewerModal({
  open,
  onClose,
  kind,
  id,
  anchorRect,
  avatarUrl,
  displayName: displayNameProp,
  nameColor,
  status,
  activity,
}: AboutMeViewerModalProps) {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const { data: chat } = useChat(activeChatId);
  const { data: character } = useCharacter(kind === "character" ? id : null);
  const { data: personas } = usePersonas(kind === "persona");
  const updateMeta = useUpdateChatMetadata();

  const profile =
    kind === "character"
      ? parseCharacterConvo((character as { data?: unknown } | undefined)?.data)
      : (() => {
          const persona = ((personas ?? []) as Array<Record<string, unknown>>).find((p) => p.id === id);
          const name = typeof persona?.name === "string" ? persona.name : "";
          const dn =
            typeof persona?.convoDisplayName === "string" && persona.convoDisplayName ? persona.convoDisplayName : name;
          return { name, displayName: dn, aboutMe: typeof persona?.aboutMe === "string" ? persona.aboutMe : "" };
        })();

  const displayName = displayNameProp || profile.displayName || profile.name || "Profile";
  const handle = profile.name && profile.name !== displayName ? profile.name : "";

  const metadata = (chat?.metadata ?? {}) as Chat["metadata"];
  const overrides = (metadata.conversationAboutMeOverrides ?? {}) as Record<string, string>;
  const override = typeof overrides[id] === "string" ? overrides[id] : undefined;
  const hasOverride = override !== undefined && override.trim().length > 0;
  const effective = hasOverride ? override! : profile.aboutMe;

  const { map: emojiMap } = useConversationCustomEmojis();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const emojiPanelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    setEditing(false);
    setDraft("");
    setEmojiOpen(false);
  }, [id, kind, open]);

  const renderAbout = (text: string) =>
    renderInlineWithCustomEmojis(text, "about-me", emojiMap, (t, kp) => [<span key={kp}>{t}</span>]);

  const insertEmoji = (token: string) => {
    const el = textareaRef.current;
    if (!el) {
      setDraft((d) => d + token);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      try {
        el.selectionStart = el.selectionEnd = caret;
      } catch {
        /* ignore */
      }
    });
  };

  // Close the emoji panel when clicking outside it (it's embedded in the card).
  useEffect(() => {
    if (!emojiOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (emojiPanelRef.current?.contains(t) || emojiBtnRef.current?.contains(t)) return;
      setEmojiOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [emojiOpen]);

  // Escape: back out of the emoji panel, then edit mode, then close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (emojiOpen) setEmojiOpen(false);
      else if (editing) setEditing(false);
      else onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, editing, emojiOpen]);

  // Anchor the card next to the avatar; flip/clamp to stay on screen.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = anchorRect;
    const card = cardRef.current;
    const cw = card?.offsetWidth ?? CARD_WIDTH;
    const ch = card?.offsetHeight ?? 360;
    const gap = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!rect) {
      setPos({ top: Math.max(8, (vh - ch) / 2), left: Math.max(8, (vw - cw) / 2) });
      return;
    }
    let left = rect.right + gap;
    if (left + cw > vw - 8) left = rect.left - cw - gap;
    if (left < 8) left = 8;
    let top = rect.top;
    if (top + ch > vh - 8) top = vh - ch - 8;
    if (top < 8) top = 8;
    setPos({ top, left });
  }, [open, anchorRect, editing, effective]);

  if (!open) return null;

  const chatId = activeChatId;
  const isPending = updateMeta.isPending;

  const writeOverrides = async (next: Record<string, string>) => {
    if (!chatId) return;
    await updateMeta.mutateAsync({ id: chatId, conversationAboutMeOverrides: next });
  };

  const handleSave = async () => {
    if (!chatId || isPending) return;
    try {
      const next = { ...overrides };
      if (draft.trim()) next[id] = draft;
      else delete next[id];
      await writeOverrides(next);
      setEditing(false);
      toast.success(draft.trim() ? "Chat-specific about me saved" : "Reverted to the default about me");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const handleClear = async () => {
    if (!chatId || isPending) return;
    const next = { ...overrides };
    delete next[id];
    try {
      await writeOverrides(next);
      setEditing(false);
      toast.success("Reverted to the default about me");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear");
    }
  };

  return createPortal(
    <div
      // Inline z-index (Tailwind didn't emit an arbitrary z-[9990]); far above chat UI.
      className="fixed inset-0"
      style={{ zIndex: 9990 }}
      data-component="AboutMeProfilePopout"
      // Transparent — no dimming, Discord-style. Click outside closes, but NOT
      // while editing (protects the draft; use Cancel / Save / Escape / ✕).
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (editing || emojiOpen) return;
        onClose();
      }}
    >
      <div
        ref={cardRef}
        // No overflow-hidden — the emoji panel opens upward past the card top and
        // must not be clipped. The banner rounds its own top corners instead.
        className="mari-modal-panel absolute w-80 max-w-[calc(100vw-1rem)] rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        style={{
          top: pos?.top ?? (anchorRect?.top ?? 80),
          left: pos?.left ?? (anchorRect ? anchorRect.right + 12 : 80),
          visibility: pos ? "visible" : "hidden",
        }}
      >
        {/* Banner */}
        <div className="h-14 w-full rounded-t-2xl" style={{ background: nameColor || "var(--accent)" }} />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 rounded-lg bg-black/25 p-1 text-white/90 transition-colors hover:bg-black/40"
          aria-label="Close"
        >
          <X size="0.875rem" />
        </button>

        <div className="px-4 pb-4">
          {/* Blown-up avatar overlapping the banner */}
          <div className="-mt-9 mb-2 flex items-end justify-between">
            <div className="relative">
              <div className="h-[4.5rem] w-[4.5rem] overflow-hidden rounded-full border-4 border-[var(--card)] bg-[var(--accent)]">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xl font-bold text-[var(--muted-foreground)]">
                    {kind === "persona" ? <User size="1.5rem" /> : displayName[0]?.toUpperCase()}
                  </div>
                )}
              </div>
              {kind === "character" && (
                <span
                  title={statusLabel(status)}
                  className={cn(
                    "absolute bottom-0.5 right-0.5 h-4 w-4 rounded-full border-[3px] border-[var(--card)]",
                    statusDotClass(status),
                  )}
                />
              )}
            </div>
          </div>

          {/* Identity */}
          <div className="mb-3">
            <h2 className="text-lg font-bold leading-tight text-[var(--foreground)]" style={nameStyle(nameColor)}>
              {displayName}
            </h2>
            {handle && <p className="text-[0.8125rem] text-[var(--muted-foreground)]">{profile.name}</p>}
            {kind === "character" && (
              <p className="mt-0.5 text-[0.75rem] text-[var(--muted-foreground)]">
                {statusLabel(status)}
                {activity ? ` · ${activity}` : ""}
              </p>
            )}
          </div>

          {/* About Me */}
          <div className="rounded-xl bg-[var(--secondary)]/50 p-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[0.6875rem] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                About Me
              </span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[0.5625rem] font-medium",
                  hasOverride
                    ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                    : "bg-[var(--background)]/60 text-[var(--muted-foreground)]",
                )}
              >
                {hasOverride ? "Chat-specific" : "Default"}
              </span>
            </div>

            {!editing ? (
              <div className="min-h-[2.5rem] whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-[var(--foreground)]">
                {effective.trim() ? (
                  renderAbout(effective)
                ) : (
                  <span className="text-[var(--muted-foreground)]">No about me set.</span>
                )}
              </div>
            ) : (
              <div className="relative">
                {/* Embedded picker inside the card's own stacking context, so it
                    reliably layers above the popout (portaled pickers fought the
                    popout's z-index). */}
                {emojiOpen && (
                  <div
                    ref={emojiPanelRef}
                    className="absolute bottom-full right-0 z-30 mb-2 flex h-[22rem] w-[21rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl"
                  >
                    <EmojiPicker
                      embedded
                      open
                      onClose={() => setEmojiOpen(false)}
                      onSelect={insertEmoji}
                      customTab={{
                        icon: "⭐",
                        label: "Custom emojis",
                        render: (query) => <CustomEmojiTab onInsert={insertEmoji} query={query} />,
                      }}
                    />
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={5}
                  autoFocus
                  placeholder="What this person shows in this conversation… :emoji: works too"
                  className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] p-2 pr-9 text-[0.8125rem] leading-relaxed outline-none transition-colors placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
                />
                <button
                  ref={emojiBtnRef}
                  type="button"
                  onClick={() => setEmojiOpen((v) => !v)}
                  aria-label="Emoji"
                  className="absolute bottom-2 right-2 rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                >
                  <Smile size="1rem" />
                </button>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {!editing ? (
              <>
                {hasOverride && (
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] disabled:opacity-50"
                  >
                    <Trash2 size="0.8125rem" />
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setDraft(effective);
                    setEditing(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
                >
                  <Pencil size="0.8125rem" />
                  Edit
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
                >
                  <RotateCcw size="0.8125rem" />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Save size="0.8125rem" />
                  {isPending ? "Saving…" : "Save"}
                </button>
              </>
            )}
          </div>
          <p className="mt-2 text-[0.625rem] text-[var(--muted-foreground)]">
            Default about me is edited on the {kind === "persona" ? "persona" : "character"} card. A chat-specific
            override only applies here.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
