# TASK (PHASE 2): Deepen Mari's Guided Flows, Add Follow-Up Chips, Update Docs

> **You are implementing this task.** This document is self-contained. Read the referenced files
> before editing; do not re-plan — the design is approved. Work on branch `guided-professor-mari`
> (target `staging`, not `main` — see `CONTRIBUTING.md § Branches`).

## Repo facts you need
- Monorepo (pnpm): `packages/client`, `packages/server`, `packages/shared`.
- Validate with `pnpm check` (TS + ESLint + build). No automated test suite. It was clean before this task started — keep it clean.
- Server logging via Pino `logger` (`import { logger } from "../lib/logger.js"`), never `console.*` in server code.
- Read `packages/client/src/components/.instructions.md` before any client edit (not expected to be needed this phase — this is mostly server prompts + docs).

## What already exists (Phase 1 — already implemented, do not redo)
Commits `b70b3093` ("Add suggestion chips to Professor Mari") and `d5c89220` ("Add suggestion chips to Professor Mari chat") on this branch already shipped:
- `packages/shared/src/types/professor-mari-workspace.ts`: `MariSuggestionChip`, `MariChipEntity`, `MariChipTone`, `MARI_STARTER_CHIPS`, `sanitizeMariSuggestionChips(raw, { maxChips })`, and a `suggestions` variant on `MariWorkspacePromptEvent`.
- `packages/server/src/services/professor-mari/workspace-agent.service.ts` (System B, the Home workspace agent): the model's JSON reply envelope `{ say, commands, suggestions, stop }` is parsed, sanitized, and emitted via `onEvent({ type: "suggestions", data })`. Protocol prompt is `workspaceCommandProtocolPrompt()` (~L399–444).
- `packages/server/src/db/seed-mari.ts` (System A, the in-chat Mari character): `MARI_ASSISTANT_PROMPT`'s `<assistant_commands>` block has a `10. SUGGESTIONS` item (~L405–409) documenting the `<suggestions>[...]</suggestions>` XML form.
- `packages/server/src/services/conversation/character-commands.ts` + `packages/server/src/services/generation/professor-mari-command-runtime.ts`: parse/execute the `suggestions` command, sanitize it, and call `args.sendAssistantAction({ action: "suggestions", suggestions })`.
- Client: `packages/client/src/components/chat/MariSuggestionChips.tsx` (shared chip component, entity-colored via `.mari-panel-gradient--<entity>`, tone-colored via `.mari-suggestion-chip--{danger,caution,success}` in `globals.css`), wired into `HomeProfessorMariChat.tsx` (System B) and `ChatInput.tsx` / `ConversationInput.tsx` (System A, gated on `PROFESSOR_MARI_ID`). Clicking a chip inserts `chip.prompt` into the draft textarea (appending if non-empty) and focuses it — it does NOT auto-send.

**This phase is prompt content + docs + one verification-driven server check. It should NOT require new shared types, new SSE event types, or new client components.** If your investigation in Step 2 concludes new plumbing genuinely is required, implement the smallest possible addition and note why in the PR description — but check twice, because the design intent was for `suggestions` to be reusable as-is.

---

## Step 1 — Deepen guided creation flows (prompt content only)

Goal: give Mari concrete field sequences to walk through for each entity type, so guided creation has a consistent shape instead of depending on the model improvising.

1a. Decide where the guided-sequence text lives: create a new shared constant so System A and System B stay in sync instead of drifting. Add to `packages/server/src/services/professor-mari/` a new file `guided-sequences.ts` (or add to an existing file in that directory if one is clearly the right home — check what's already there first) exporting:
```ts
export const MARI_GUIDED_SEQUENCES = `
Guided creation sequences — when the user wants to create something and hasn't given full details, walk through these fields ONE AT A TIME, offering 3-5 short illustrative example answers as suggestions for each step (the user can also just type their own answer):

Character: name -> one-line vibe/personality -> scenario/setting -> first message (greeting). Tag suggestions entity:"characters".
Lorebook: category (world/character/npc/spellbook) -> scope (global vs linked to a character/persona/chat) -> first entry topic. Tag suggestions entity:"lorebooks".
Persona: name -> appearance -> backstory/personality. Tag suggestions entity:"personas".
Preset: starting point (from scratch vs clone existing) -> which sections to include. Tag suggestions entity:"presets".

Keep "say" to one short sentence framing the question; put the substantive options in "suggestions", not in prose, so most steps can be completed by tapping a chip alone. Suggestions are illustrative example answers, not the only valid input.
`.trim();
```
(Adjust exact wording as needed but preserve the structure: one sequence per entity, arrow-separated fields, the "keep say short" rule, and the "illustrative, not exclusive" clarification.)

1b. `packages/server/src/services/professor-mari/workspace-agent.service.ts` — import `MARI_GUIDED_SEQUENCES` and append it into the string returned by `workspaceCommandProtocolPrompt()` (~L399–444), near the existing `suggestions` field-rules text added in phase 1.

1c. `packages/server/src/db/seed-mari.ts` — import `MARI_GUIDED_SEQUENCES` (or if seed-mari.ts is plain data with no imports of server services currently, check for circular-import risk first — `professor-mari/` service files should be safe to import from `db/seed-mari.ts`; if there's a real cycle, duplicate the text as a local constant instead and note it in the PR) and splice it into `MARI_ASSISTANT_PROMPT` near the existing `10. SUGGESTIONS` command description (~L405–409).

1d. Run `pnpm check`.

---

## Step 2 — Follow-up ("what's next") chips after completion

Goal: after Mari creates or updates something, her next turn should offer 2–4 contextual next-step chips (e.g., after character creation: "Add a lorebook for this character", "Create a chat with them", "Tweak the personality", "Create another character").

**2a. Investigate before changing anything — this determines whether System B needs a code fix or just a prompt line:**
- Read `packages/server/src/services/professor-mari/workspace-agent.service.ts`'s tool loop: after an `app_data` (or other) command executes, is the result appended to `messages` (the model's conversation history) before the next model turn? Search for where `commands` are executed and where their output is pushed into the history array the model sees. If yes — the model already sees "I just created X" — then this step is prompt-only for System B (Step 2c below).
- If command results are NOT fed back into the model's visible history (i.e., the model only sees its own prior `say`/`commands` JSON, not the actual DB write result), that's a real gap: add the command result (success/failure + key identifying info like the new entity's name/id) as a message the model sees on its next turn, following whatever pattern already exists for surfacing `app_data` read results back to the model (there should be one, since reads like `character.list` clearly need their output visible to the model — reuse that exact mechanism for write results too, don't invent a new one).

**2b. Read `packages/server/src/routes/generate/professor-mari-prompt-context.ts` and `packages/server/src/services/generation/professor-mari-command-runtime.ts`** for System A: commands there execute and return a result, but System A is not a tool loop — the model doesn't see the result until a new generation is triggered by the next user message. Check whether `<available_names>` in the prompt context (built by `professor-mari-prompt-context.ts`) is refreshed per-request from the DB (likely yes, since it's meant to list currently-existing items) — if so, Mari technically won't know about something she just created until her NEXT reply cycle, meaning the correct fix for System A is prompt-based: tell her to proactively offer follow-up suggestions in the SAME message where she confirms creation (she already knows what she's about to create from the conversation), not to wait and see a result. Do not build new plumbing for System A unless 2a-style investigation of System A specifically proves the model truly cannot know what it just created within the same turn.

**2c. Prompt changes (both systems), add near the existing `suggestions` guidance:**
```
Immediately after you successfully create or update something, offer 2-4 follow-up suggestions for a
natural next step: link it to something else, refine a field, create a related item, or open it for
full editing. Tag each with the relevant entity.
```
Add this line to `workspaceCommandProtocolPrompt()` in `workspace-agent.service.ts` and to the `<assistant_commands>` `SUGGESTIONS` item in `seed-mari.ts` (same two files touched in Step 1).

2d. If 2a's investigation found a genuine plumbing gap for System B, implement the smallest fix (feed command results into the model-visible message history using the existing pattern for read-result surfacing) and note it clearly in the PR description as "found and fixed: command results weren't visible to the model." If no gap was found, note that too ("verified command results already flow back to the model — no code change needed, prompt-only fix").

2e. Run `pnpm check`.

---

## Step 3 — Docs & discoverability

3a. `docs/PROFESSOR_MARI.md`:
- In `## What Mari Can Do` (~L27–45): add a bullet: *"Offer quick-reply suggestion chips above the chat input, color-coded by entity type, to guide multi-step creation without typing everything by hand."*
- In `## How To Ask Mari` (~L53 onward): add a short paragraph explaining chips appear on an empty chat as starting points (Create a Character, Create a Lorebook, Create a Persona, etc.) and dynamically during a conversation once Mari is guiding the user through creating or editing something; clicking a chip fills the input (still editable) rather than sending immediately.
- Skim `## What Mari Cannot Do Yet` (~L78) — if it implies creation is unguided/form-only, adjust or remove that line.

3b. `docs/FAQ.md` (~L101–110, "What can Professor Mari do?" entry) — add one sentence about guided, chip-driven creation, consistent with the wording in `PROFESSOR_MARI.md`. Keep it short; it already links to `PROFESSOR_MARI.md` for detail — don't duplicate the whole explanation.

3c. `CHANGELOG.md` — read the top of the file to find the current unreleased/in-progress version heading and its existing bullet style (see the Professor Mari bullets around L219–223 for tone/format precedent). Add one bullet describing the new suggestion-chip feature (chips + guided creation + follow-up suggestions).

3d. Optional, only if trivial: check `packages/client/src/components/onboarding/OnboardingTutorial.tsx` for whether it already references the Home Mari chat. If it does, add one beat mentioning starter chips. If Mari isn't already part of the tour, skip this — it's not required by the CLAUDE.md docs-alignment rule (that rule is about README/CONTRIBUTING/CHANGELOG/docs, not onboarding copy).

---

## Definition of done / verification
1. `pnpm check` clean at the end (it was clean before this task — keep it that way).
2. Manual/live test (run the app, per project convention — type-checking alone doesn't verify behavior):
   - Fresh Home Mari chat → click "Create a character" starter chip → walk the guided sequence via chips only (name → vibe → scenario → greeting) and confirm each step's chips are relevant example answers (not generic).
   - After creation completes, confirm 2–4 follow-up chips appear.
   - Quick pass on lorebook and persona guided flows.
   - Same checks in a normal chat with the Mari character (System A) — confirm parity, and specifically confirm whether follow-up chips appear there (this depends on what Step 2b's investigation concluded — verify the actual behavior matches what you decided to implement).
   - Confirm the floating assistant window (compact chip variant) still works — this phase shouldn't touch its wiring, but check for regressions.
3. Proofread the three doc files for consistency with each other and with what you actually observed in step 2.

## PR notes (per CLAUDE.md)
- Target `staging`. Leave all validation/test-plan checkboxes UNCHECKED in the PR description; list manual-verification steps explicitly ("Manually verify X in browser").
- Make the "why" explicit: this closes the gap between phase-1 infrastructure and an actually-guided creation experience, and keeps docs in sync with new behavior.
- If no linked issue exists for this phase-2 work, note in the PR that one should be opened.
- Explicitly call out in the PR description whether Step 2 required a real code fix or was prompt-only, and for which system(s) — this is the one part of the task with a genuine open investigation, so reviewers need to know what you found.
