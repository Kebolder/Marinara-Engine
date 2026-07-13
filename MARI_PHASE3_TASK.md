# TASK (PHASE 3): Professor Mari Suggestion Chips — Polish & UI/UX

> **You are implementing this task.** This document is self-contained. Read the referenced files
> before editing; do not re-plan — the design is approved. Work on branch `guided-professor-mari`
> (target `staging`, not `main` — see `CONTRIBUTING.md § Branches`).

## Repo facts you need
- Monorepo (pnpm): `packages/client`, `packages/server`, `packages/shared`.
- Validate with `pnpm check` (TS + ESLint + build). No automated test suite. It should stay clean — this phase is component/CSS only, no type changes expected.
- Read `packages/client/src/components/.instructions.md` before editing client code. Tailwind v4 CSS-vars, no barrel files, direct imports.
- Lucide icons (`lucide-react`) are already a project dependency — use them, don't add a new icon library.

## What already exists (Phases 1–2 — already implemented, do not redo)
- `packages/shared/src/types/professor-mari-workspace.ts`: `MariSuggestionChip`, `MariChipEntity`, `MariChipTone`, `MARI_STARTER_CHIPS`, `sanitizeMariSuggestionChips`.
- `packages/client/src/components/chat/MariSuggestionChips.tsx`: the chip component. Currently:
  ```tsx
  const CHIP_ICONS: Record<string, LucideIcon> = { UserPlus, BookOpen, Sparkles, Wand2, Dices };
  // ...
  className={cn(
    "mari-panel-gradient-button max-w-full text-left text-xs leading-tight",
    chip.entity && `mari-panel-gradient--${chip.entity}`,
    chip.tone === "danger" && "mari-suggestion-chip--danger",
    chip.tone === "caution" && "mari-suggestion-chip--caution",
    chip.tone === "success" && "mari-suggestion-chip--success",
  )}
  title={chip.prompt}
  ```
  Wired into `HomeProfessorMariChat.tsx` (Home workspace agent) and `ChatInput.tsx` / `ConversationInput.tsx` (in-chat Mari character, gated on `PROFESSOR_MARI_ID`). Clicking inserts `chip.prompt` into the draft (does not auto-send). Reset/lifecycle (clearing stale chips on new prompt/chat-switch/reset) is already correct on both surfaces — do not touch that logic.
- `packages/client/src/styles/globals.css` ~L791–872: base `.mari-panel-gradient-button` / `.mari-panel-gradient--<entity>` tokens (pre-existing, used app-wide for panel buttons too — characters=pink, lorebooks=amber, personas=green, presets=purple, connections=blue, agents=violet, settings=gray). Phase-1 additions nearby (~L866–911) add `.mari-suggestion-chips` (row layout), `.mari-suggestion-chips--compact`, and `.mari-suggestion-chip--{danger,caution,success}` tone overrides.

**This phase does NOT touch the backend, the shared types, or the chip lifecycle/reset logic.** It's a targeted visual/accessibility pass on the two files above.

---

## Problems to fix (confirmed by reading the shipped code)

1. **Neutral chips look character-themed.** A chip with no `entity` and no `tone` (the two open-ended starters "What can you do?" / "Surprise me" in `MARI_STARTER_CHIPS`) falls through to `.mari-panel-gradient-button`'s default background, which resolves to `--marinara-app-accent-solid` — Mari's pink accent. So "explore" chips visually read as "character" chips.
2. **Incomplete icon coverage.** `CHIP_ICONS` only maps 5 icon names (`UserPlus, BookOpen, Sparkles, Wand2, Dices`) which the model may or may not choose to emit. There's no fallback icon per `entity`, so presets/connections/agents/settings chips typically render with no icon at all.
3. **No entrance motion.** A freshly-emitted chip set pops in instantly with no transition.
4. **No scroll affordance.** `.mari-suggestion-chips` is `overflow-x: auto` with no visual hint that content extends off-screen when chips overflow.
5. **No accessibility affordances.** The chip `<button>` has no `aria-label` — its accessible name comes from the visible `<span>` text, which is CSS-`truncate`d, so screen readers may announce a cut-off label. The row has no group semantics. The compact variant (`.mari-suggestion-chips--compact .mari-panel-gradient-button`) sets `min-height: 2rem` (32px), below common ~44px touch-target guidance, in the floating assistant window.

---

## Step 1 — Neutral chip styling + icon coverage

**`packages/client/src/styles/globals.css`** — add near the other phase-1 chip classes (~L866–911):
```css
.mari-suggestion-chip--neutral {
  --mari-panel-gradient-start: color-mix(in srgb, var(--foreground) 14%, var(--card) 86%);
  --mari-panel-gradient-end: color-mix(in srgb, var(--foreground) 22%, var(--card) 78%);
  --mari-panel-gradient-text: var(--foreground);
  border-color: color-mix(in srgb, var(--border) 70%, transparent);
}
```

**`packages/client/src/components/chat/MariSuggestionChips.tsx`**:
- In the `className` composition, when a chip has **neither** `chip.entity` nor `chip.tone`, add `mari-suggestion-chip--neutral` (instead of leaving it to the default pink gradient fallback).
- Add a fallback icon map keyed by entity, used when `chip.icon` is missing or unrecognized but `chip.entity` is set:
  ```tsx
  import { Bot, Link2, MessageCircle, Settings, SlidersHorizontal, /* + existing imports */ } from "lucide-react";

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
  ```
  Then: `const Icon = (chip.icon && CHIP_ICONS[chip.icon]) || (chip.entity && ENTITY_DEFAULT_ICON[chip.entity]) || undefined;`
  Import `MariChipEntity` type from `@marinara-engine/shared` alongside the existing `MariSuggestionChip` import.

No changes needed to `MARI_STARTER_CHIPS` — the two open-ended starters already have no `entity`, so they'll pick up the neutral style automatically once the component change lands.

---

## Step 2 — Motion & scroll polish

**`packages/client/src/styles/globals.css`**:
- Reuse the existing `message-in` keyframe (already defined ~L3378–3390, used for chat message entrances) rather than adding a new one:
  ```css
  .mari-suggestion-chips .mari-panel-gradient-button {
    animation: message-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  ```
- Respect the project's existing reduced-motion convention: find one of the existing `@media (prefers-reduced-motion: reduce)` blocks (search the file — there are several, e.g. ~L2391, ~L3016, ~L4533, ~L4866) and add a rule disabling/shortening this new animation there (e.g. `.mari-suggestion-chips .mari-panel-gradient-button { animation: none; }`), following whatever pattern the surrounding rules in that block already use.
- Scroll affordance — add an edge fade via CSS mask:
  ```css
  .mari-suggestion-chips {
    mask-image: linear-gradient(to right, transparent 0, black 12px, black calc(100% - 12px), transparent 100%);
  }
  ```
  **Verify in the browser** that this doesn't visually clip the first/last chip when the row does NOT overflow (short chip sets). If it does clip unacceptably, narrow the fade width (e.g. `8px`) or scope the mask to only apply when overflow is actually present (would require a small JS check — prefer the pure-CSS fix first, only add JS if the CSS approach genuinely looks bad).

---

## Step 3 — Accessibility

**`packages/client/src/components/chat/MariSuggestionChips.tsx`**:
- Add `role="group"` and `aria-label="Suggested replies"` to the outer row `<div>`.
- Add `aria-label={chip.label}` to each chip `<button>` so screen readers get the full, untruncated label (the visible `<span>` stays truncated via CSS). Keep the existing `title={chip.prompt}` as-is (mouse-hover preview of what gets inserted) — don't change what `title` shows, just add `aria-label` alongside it.
- No change needed for `disabled` — native `disabled` attribute is already applied (confirm, don't add redundant `aria-disabled`).

**`packages/client/src/styles/globals.css`**:
- In `.mari-suggestion-chips--compact .mari-panel-gradient-button`, bump `min-height` from `2rem` toward better touch-target size. Try `2.75rem` (44px) first; adjust `padding`/`border-radius` proportionally. **Check visually** against the floating assistant window's other compact controls (header buttons, input-row buttons) — if 44px looks oversized/breaks the compact chrome, step down to `2.25rem` (36px) instead and note the trade-off in the PR description.

---

## Definition of done / verification
1. `pnpm check` clean.
2. Manual browser check (per project convention — UI changes need to be seen, not just type-checked):
   - Empty Home Mari chat: "What can you do?" / "Surprise me" starters render in the new neutral/muted style, visually distinct from the pink "Create a character" chip.
   - Chips for presets/connections/agents/settings entities show a default icon even when the model doesn't specify one (can trigger this by getting Mari to emit such chips, or by temporarily testing with mock data during development).
   - New chip sets fade/slide in; toggling OS-level "reduce motion" disables the animation.
   - Force chip overflow (narrow window or floating window) and confirm the edge fade looks right and doesn't clip a short, non-overflowing row.
   - Tab through chips with keyboard only; use the browser's accessibility inspector to confirm each button's accessible name is the full untruncated label.
   - Compare floating-window (compact) chip touch-target size against neighboring compact controls (paperclip/connection buttons) — should feel comfortably tappable, not oversized.
3. Confirm no regressions to the phase-1/2 chip lifecycle (chips still clear correctly on new prompt, chat switch, reset — this phase shouldn't touch that logic, but verify nothing broke).

## Also flag, do not fix as part of this task
While auditing the current state, it was noted that the phase-2 `CHANGELOG.md` entry claims Mari now offers "guided creation follow-ups" for contextual next actions after completing a creation, but no prompt text implementing that behavior ("Immediately after you successfully create/update something, offer follow-up suggestions...") appears to have landed in `packages/server/src/db/seed-mari.ts` or `packages/server/src/services/professor-mari/workspace-agent.service.ts` — only the guided *sequence* prompt (`packages/server/src/services/professor-mari/guided-sequences.ts`) landed. **Do not fix this as part of phase 3** (it's a phase-2 content gap, out of scope for a polish/UI-UX pass) — just flag it in your PR description so a maintainer can follow up, e.g.: "Note: CHANGELOG.md's 'guided creation follow-ups' claim may not match current prompt behavior — worth a follow-up check before release."

## PR notes (per CLAUDE.md)
- Target `staging`. Leave all validation/test-plan checkboxes UNCHECKED in the PR description; list manual-verification steps explicitly ("Manually verify X in browser").
- Make the "why" explicit: this closes visual/accessibility gaps identified after phases 1–2 shipped the functional chip feature.
- If no linked issue exists for this phase-3 work, note in the PR that one should be opened.
