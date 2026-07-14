# Hierarchical Maps and Spatial Context V3

Status: Proposed, implementation-ready after maintainer approval

Audience: Product, design, and Marinara Engine contributors

Supersedes: `hierarchical-locations-prd-v2.md`

## Architecture boundary

This plan treats spatial orientation as a focused product capability with a narrow state boundary.

The feature is a hierarchical map and spatial-orientation system, not a generic Voxta-style scenario engine. It borrows one useful Voxta pattern: persistent state selects a small, relevant prompt context. It does not initially add flags, variables, events, scripts, timers, or a separate action-inference model.

The supported owner modes are Roleplay and Game. The legacy `visual_novel` enum value is compatibility residue and is not a supported product mode.

The MVP has four layers:

| Layer | Responsibility | Example |
| --- | --- | --- |
| Map definition | Stable spatial truth | The Library is inside the Wizard Tower |
| Runtime state | The current scene location | The scene is currently in the Library |
| Prompt projection | Bounded model orientation | Breadcrumb, current memory, reachable exits |
| Transition | Validated state change | Move from Library to Observatory |

The state machine is deliberately small:

```text
current location + requested destination + definition revision
                              ↓
                  validate ownership and reachability
                       ↙ accepted       rejected ↘
              persist snapshot         preserve state
```

Manual movement ships first. Later, a constrained model tool such as `change_location({ destinationId })` may request the same transition. The server, not the model, validates and applies it. A separate action-inference call is deferred unless later evidence shows it is needed.

## Summary

Add a shared Hierarchical Map feature for Roleplay and Game. It provides an author-defined location hierarchy, one authoritative focal location, bounded current-location prompt context, and server-validated movement.

Lorebooks remain the canonical source for reusable world facts. The hierarchy may reference existing lorebook entries by stable ID so the active location can select relevant lore without copying or rewriting it. AI map drafting may use explicitly selected lorebooks as grounded source material, and it must distinguish source-backed locations from inferred or invented additions.

Connected Conversation can later read a safe projection of the linked story location, but it never owns or changes spatial state.

```text
authoritative hierarchy + current location
                    ↓
resolve breadcrumb, context, and valid destinations
                    ↓
build the mode-specific prompt
                    ↓
commit a validated move with the next owner turn
                    ↺
```

This is not a general scenario engine. It does not add flags, events, author JavaScript, or pathfinding. It does include a visual, nested map browser with map, layer, and list presentations.

## Product decisions

These decisions resolve the open questions from V2:

1. The hierarchy definition and current location are stored separately.
2. Current location is snapshotted with committed message and swipe state so branches, regeneration, and checkpoints restore the correct position.
3. Manual movement commits atomically with the next owner-mode user turn, before prompt generation.
4. Spatial Context is authoritative when enabled. Game's legacy free-text location must not become a second source of truth.
5. Roleplay and Game use one shared spatial projection contract with thin mode-specific prompt adapters.
6. `awarenessSummary` is author-written. When absent, Conversation receives a bounded excerpt of the public description only.
7. Conversation uses scene-level wording unless authoritative presence data proves the connected character is present.
8. Direct links and visual child placement are included in the MVP.
9. Existing Game grid and node maps may bind explicitly to hierarchy locations; names are never matched automatically.
10. Lorebooks own canonical reusable world facts; the map owns spatial identity, containment, navigation, and current-location state. Map locations reference lorebook entries by stable ID and never copy their content.
11. A location attachment is an explicit chat-scoped activation source. While that exact location is current, its enabled entries may activate without a keyword match, but disabled or explicitly excluded books and entries remain disabled.
12. Lorebook-grounded map drafting follows the owner runtime UI and precedes Connected Conversation. When source lorebooks are selected, the draft must expose which locations are source-backed, inferred, or invented instead of presenting unsupported geography as canon.
13. Model-requested movement remains a later phase.

## Scope

| Mode | Owns hierarchy | Moves focal location | Story projection | Connected projection |
| --- | ---: | ---: | ---: | ---: |
| Roleplay | Yes | Yes | Yes | N/A |
| Game | Yes | Yes | Yes | N/A |
| Conversation | No | No | No | Later phase, read-only |

## User experience

### Authoring

Chat Settings shows a compact Spatial Context section with:

- Enabled state
- Current breadcrumb
- Location and warning counts
- Open Location Editor action

The editor is a lazy-loaded map workspace, not a narrow settings form:

- Desktop uses a hierarchy pane, local map or layer view, and location-detail pane.
- Mobile shows one pane at a time with clear back navigation.
- Validation appears beside the affected field or node.
- Save state and revision conflicts are always visible.
- Archive is the primary removal action; hard delete is restricted.
- Selection previews a location. A distinct Enter action navigates to it, so click never ambiguously means inspect, edit, and move.
- Each parent presents children as a positioned map, ordered layers, or an accessible list.
- Duplicate subtree supports creator reuse without requiring cross-chat templates in the MVP.
- Each location has a progressive `Linked lore` section that searches existing lorebook entries, shows disabled or missing references, and supports Open entry and Detach without copying or deleting lore content.

### Lorebook-grounded drafting

The AI map builder offers lorebook grounding when the owner chat has selected or active lorebooks. Grounding is explicit and inspectable, not a normal keyword scan.

- Game setup uses the lorebooks selected in the Lorebooks step as default map sources.
- Roleplay uses the open chat's active lorebooks as defaults and lets the creator change the source selection in the map builder.
- `Strict canon` creates every named node from at least one selected lore entry. It preserves multiple sourced roots rather than inventing unsupported connecting places.
- `Canon with expansion` preserves sourced names and relationships while allowing clearly labelled inferred or invented locations to fill practical gaps.
- `Setup only` preserves the existing behavior and uses setup, world overview, story arc, scenario, and character context without lorebook grounding.
- When selected lorebooks exist, `Canon with expansion` is the approachable default. The builder keeps `Strict canon` one control away for lorebook-heavy creators.

Every generated node in the draft preview shows `Lore-backed`, `Inferred`, or `Added by AI`. Lore-backed nodes list their source entries and provide Open entry. The label proves a valid source reference, not that the model interpreted the prose perfectly, so creator review remains the semantic authority. Apply changes only the local working copy, and Save remains the persistence boundary.

### Runtime movement

Owner-mode chat surfaces show:

- Persisted current breadcrumb
- Valid destination picker
- Clearly labelled pending destination

Selecting a destination does not immediately change authoritative state. Sending the next message submits the destination ID and expected revision separately from visible message text. The server commits the move before assembling the reply prompt.

If validation fails, the message and movement are not partially committed. The client keeps the draft and explains the conflict.

## Data model

Definitions belong in chat metadata. Runtime position belongs in snapshot history.

```ts
export type SpatialOwnerMode = "roleplay" | "game";

export interface ChatLocation {
  id: string;
  name: string;
  parentId: string | null;
  description: string;
  kind: "region" | "settlement" | "place" | "building" | "floor" | "room";
  modelMemory?: string;
  icon?: string;
  childPresentation: "map" | "layers" | "list";
  placement?: { x: number; y: number };
  layerOrder?: number;
  awarenessSummary?: string;
  lorebookEntryIds: string[];
  links: ChatLocationLink[];
  status: "active" | "archived";
  sortOrder: number;
}

export interface ChatLocationLink {
  targetId: string;
  label?: string;
  bidirectional: boolean;
  state: "available" | "hidden" | "blocked";
}

export interface SpatialContextDefinition {
  schemaVersion: 1;
  ownerMode: SpatialOwnerMode;
  enabled: boolean;
  locations: ChatLocation[];
  startingLocationId: string | null;
  revision: number;
}

export interface SpatialContextSnapshot {
  id: string;
  chatId: string;
  messageId: string;
  swipeIndex: number;
  currentLocationId: string | null;
  definitionRevision: number;
  createdAt: string;
}

export interface PendingSpatialTransition {
  destinationId: string;
  expectedDefinitionRevision: number;
  expectedCurrentLocationId: string | null;
  commandId: string;
}
```

Do not store `ownerChatId` inside `SpatialContextDefinition`; the containing chat is the owner. Stable opaque IDs survive renames and reparenting.

The first owner MVP treats a missing `lorebookEntryIds` field as an empty array, so the lorebook package can extend schema version 1 without eagerly rewriting existing definitions. Entry references are stable IDs only. Lorebook names, entry names, keys, and content are resolved at read or prompt time and are never copied into the spatial definition.

## Graph rules

Valid destinations are active:

- Children of the current location
- The current location's parent
- Direct link targets
- Reverse targets of bidirectional links

Siblings are not automatically adjacent.

Reject:

- Duplicate IDs
- Missing parent or link targets
- Self-parenting or parent cycles
- More than 500 locations
- Depth above 20
- More than 50 links per location
- More than 50 lorebook entry references per location
- Duplicate lorebook entry references on one location
- Placement coordinates outside 0 to 100
- Invalid or duplicate layer ordering within a layer parent
- Movement to archived, hidden, blocked, or unreachable locations
- Stale revisions or a changed current location
- Reused command IDs with different contents
- Mutation attempts from Conversation

Text limits:

- Name: 200 characters
- Description: 4,000 characters
- Awareness summary: 1,000 characters
- Private model memory: 8,000 characters

Direct-link cycles are valid. Parent cycles are not.

### Archive and delete

- The current or starting location needs an atomic replacement before archive.
- A location with active children cannot be archived.
- Hard delete is allowed only for an archived leaf with no inbound links.
- Descendants are never silently reparented.
- Missing lorebook references appear as warnings, not graph corruption.
- Archiving or deleting a location never deletes its referenced lorebook entries.
- Deleting a lorebook or entry never silently rewrites the map. The location retains a repairable broken reference until the creator detaches or replaces it.

## Persistence and history

### Definitions

Store `SpatialContextDefinition` in `chat.metadata.spatialContext`. Definition updates require `expectedRevision`; accepted updates increment the revision.

### Runtime position

Store the current position using message/swipe-addressable snapshots, following the existing Game State snapshot pattern.

- New owner chats begin at `startingLocationId`.
- A committed turn creates a snapshot after any accepted movement.
- Regeneration associates position with the resulting swipe.
- Switching swipes resolves the matching snapshot.
- Branching at a message copies the snapshot effective at that point, not the source chat's latest position.
- Game checkpoints reference or include the applicable spatial snapshot.
- Reload resolves the latest committed snapshot.

Definition editing is not rewound by ordinary message branching in the MVP. A branch receives a copy of the current definition, with its own future revision history. Its runtime position comes from the branch point.

## Prompt projections

A shared server projection service resolves structured projection data. Thin mode adapters turn it into final prompt text.

### Owner story projection

Include:

- Breadcrumb names
- Current location ID
- Public description
- Current-location private model memory
- Available destination names, IDs, and link labels
- An authoritative-state instruction

Exclude all unrelated location descriptions and memories, hidden or blocked destinations, canvas coordinates, and editor metadata.

### Current-location lore activation

The owner spatial resolver returns the exact current location's `lorebookEntryIds` beside the normal spatial projection. The formatter does not paste those IDs or entry contents into the spatial block. Instead, prompt assembly passes the IDs into the existing lorebook processor as forced candidates with activation source `current_location`.

Rules:

- Only the exact current location activates attached lore in the first release. Parents and descendants do not inherit entries implicitly.
- An explicit location attachment can activate an enabled entry even when its lorebook is not otherwise global, character-linked, persona-linked, or pinned to the chat.
- A globally disabled lorebook, disabled entry, or explicit chat exclusion always wins over the attachment.
- Existing lorebook macros, insertion positions, recursion, ordering, and per-book token and entry limits are reused.
- Location-attached lore also has a total reserved cap of 2,048 tokens per owner prompt. Truncation is deterministic and appears in Active Context.
- An entry activated by both location and ordinary keyword, semantic, recursive, or constant rules is injected once and reports every activation source.
- A committed move resolves the destination's entries before the owner reply prompt is assembled. Pending or rejected movement does not change lore activation.
- Game wording treats the location as the party's authoritative position. Roleplay wording treats it as the focal scene and does not infer that every character is present.

The Active Context UI groups these entries under `Current location`, shows the owning lorebook, activation sources, token use or truncation, and Open entry. Broken, disabled, and excluded references remain visible in the map editor but never enter the prompt.

### Connected Conversation projection

Added in Phase 3. Include only:

- Linked story name and mode
- Breadcrumb
- `awarenessSummary`, or a bounded public-description excerpt
- Read-only instruction
- Character presence only when authoritative state proves it

Never include private model memory, internal IDs, hidden destinations, the complete hierarchy, location-attached lorebook IDs, or location-attached lorebook content.

Game may prove presence through its committed `presentCharacters` state. Roleplay uses neutral wording such as “The linked story's current scene is…” until it gains an explicit presence source. Never infer presence by character name.

### Required prompt paths

The same projection resolver must feed:

- Roleplay generation
- Game GM generation
- Dry-run preview
- Live Peek Prompt assembly

Cached Peek Prompt continues to display the exact prompt originally sent. Debug logging includes the final projection but must not log private model memory at normal levels.

## Game compatibility

Existing Game grid and node maps remain local or tactical representations. The hierarchy becomes the world and containment layer above them.

When Spatial Context is enabled:

- Spatial Context supplies the authoritative named location to prompts.
- The Game tracker displays the spatial breadcrumb as its location.
- Legacy model or manual patches cannot independently change the free-text Game location.
- `GameMap.spatialLocationId` may bind a whole map to one hierarchy location.
- `GridCell.spatialLocationId` and `MapNode.spatialLocationId` may bind an enterable destination.
- Bindings use stable IDs only; names are never matched automatically.
- Selecting a bound destination creates the same pending transition as the hierarchy browser.
- Moving between unbound cells or nodes changes only tactical party position.
- Entering a location may select its bound local map; leaving may select the closest bound ancestor map.

When disabled, existing Game location behavior is unchanged.

This boundary preserves the current map UI and saves while preventing two sources of named spatial truth.

## API shape

```text
GET  /api/chats/:chatId/spatial-context
PUT  /api/chats/:chatId/spatial-context
```

Definition update:

```ts
interface UpdateSpatialContextRequest {
  expectedRevision: number;
  expectedCurrentLocationId: string | null;
  replacementCurrentLocationId?: string | null;
  definition: SpatialContextDefinition;
}
```

`replacementCurrentLocationId` is only used when a definition edit archives the effective current location. The server must validate and apply that replacement in the same write as the definition revision. Ordinary movement still goes through owner-mode turn submission.

Pending movement is submitted through the existing owner-mode turn request rather than a separate immediate-transition endpoint.

The server validates definition integrity, owner mode, expected revision, expected current location, reachability, and command idempotency inside the same transaction as message submission.

Return `409 Conflict` for stale state and `400 Bad Request` for invalid graphs or destinations. Errors must not reveal hidden destinations.

## Implementation plan

### Phase 0: shared core and proof fixtures

- Add shared types and Zod schemas.
- Add pure graph validation, breadcrumb, and destination helpers.
- Add deterministic fixtures for valid and invalid graphs.
- Confirm message/swipe snapshot integration points for Roleplay and Game.
- Measure representative prompt projections.

Exit condition: schema, movement semantics, and snapshot behavior are proven without UI.

### Phase 1: owner MVP

1. Add definition persistence with optimistic concurrency.
2. Add spatial snapshot storage and resolution.
3. Integrate atomic pending movement into owner-mode turn submission.
4. Handle reload, swipes, branches, and Game checkpoints.
5. Add the shared projection service to every required prompt path.
6. Add the compact settings section, hierarchy navigator, local map canvas, layer selector, and editor workspace.
7. Add breadcrumb, destination picker, preview, and pending state to owner surfaces.
8. Bind existing Game maps, cells, and nodes through stable location IDs.
9. Reconcile the Game tracker location when enabled.

Exit condition: Roleplay and Game can author, move, persist, restore, and prompt from the same spatial model. Bound Game-map movement and unbound tactical movement remain distinct.

### Phase 2A: location lorebook bindings and runtime

- Add `lorebookEntryIds` to locations with an empty-array compatibility default.
- Add inline attach, open, detach, disabled, excluded, and broken-reference states to the Location Editor.
- Resolve exact-current-location references as forced candidates through the existing lorebook processor.
- Reuse normal macros, insertion, recursion, ordering, and per-book limits; add deterministic deduplication and a 2,048-token total location-lore cap.
- Report `current_location` alongside any keyword, semantic, recursive, or constant activation sources in Active Context.
- Prove identical behavior in Roleplay and Game, including movement, reload, regeneration, swipes, and branches.
- Prove that Connected Conversation receives neither location lore IDs nor contents.

Exit condition: creators can explicitly bind existing lore to locations, and only the accepted current location activates those entries in owner prompts.

### Phase 2B: lorebook-grounded map drafting

- Extend create, replace, and history-safe expansion requests with grounding mode and explicit lorebook or entry source selection.
- Read selected enabled lore entries directly for this authoring operation instead of relying on keyword activation or the generated world overview.
- Build a connection-aware bounded source catalog with visible omission counts and deterministic ordering.
- Give the model temporary source keys, validate every returned key server-side, and persist only stable entry IDs.
- Support `setup_only`, `lore_strict`, and `lore_expand` behavior with preview provenance.
- Auto-bind valid source entries to generated locations while preserving Apply and Save as separate review boundaries.
- Preserve every existing location ID and lore binding during add-only expansion.

Exit condition: a lorebook-literate creator can generate a map grounded directly in selected canon, identify every unsupported addition, and decline or edit it before persistence.

### Phase 3: connected Conversation

- Resolve the latest owner state through `connectedChatId` at generation time.
- Add a bounded read-only projection.
- Use conservative presence wording.
- Exclude location-attached lore IDs and content even when the owner prompt activates them.
- Cover unlink, relink, deleted owner, malformed links, concluded stories, and location-lore negative controls.

### Phase 4: model-requested movement

- Add a typed `change_location` request for owner modes.
- Apply the same revision, reachability, and idempotency validation.
- Record accepted and rejected requests in debug diagnostics.
- Conversation remains unable to request transitions.

### Phase 5: creator templates

- Save and import reusable location subtrees or full maps.
- Allow creators to ship starter maps with characters after ownership and merge behavior are specified.
- Preserve internal references while generating new IDs when copying into another chat.

## Repository implementation blueprint

Planning baseline: `hierarchical-locations` after merging `staging` at `4fd752ea` on 2026-07-13. At this baseline the branch contains the V1, V2, and V3 planning documents only. No Spatial Context runtime code exists yet.

### Confirmed integration constraints

| Concern | Current repository behavior | Implementation consequence |
| --- | --- | --- |
| Definition storage | Chat metadata is JSON and generic metadata updates are partial merges. | Spatial definitions stay in `chat.metadata.spatialContext`, but use a dedicated validated endpoint instead of the generic metadata patch route. |
| Runtime history | `game_state_snapshots` is the only message and swipe-addressable world-state history. | Add a mode-neutral spatial snapshot table. Do not add Spatial Context columns to Game-only snapshots. |
| Owner turn start | `/api/generate` commits visible Game state, creates the user message, then updates attachments and persona data in separate calls. | Add a small transaction-bound owner-turn service so user-message creation and an accepted spatial move succeed or fail together. Keep provider calls outside the transaction. |
| Swipes and branches | Swipe deletion shifts Game snapshot indexes. Branch creation copies all Game and turn-game snapshots to new message IDs. | Spatial snapshots must participate in both paths and must copy the snapshot effective at an earlier branch point. |
| Prompt assembly | Live generation, dry run, live Peek Prompt, cached Peek Prompt, and Game GM prompts have distinct assembly paths. | Resolve structured spatial data once, then call a shared formatter/injector from every live path. Cached Peek Prompt continues to read the exact saved provider request. |
| Client data | Server data uses React Query. Per-chat input drafts survive navigation and reload. Heavy editors are lazy-loaded through `AppShell`. | Add a dedicated query/mutation hook, persist pending transitions beside per-chat drafts, and route a lazy Location Editor through the existing detail-view model. |
| Game travel | Game maps already have grid and node positions plus a pending map move that becomes visible `*moves to ...*` text. | Add optional stable-ID bindings. Bound destinations use structured spatial requests without visible prose; unbound movement keeps the existing tactical flow. |
| Storage backends | File-native storage is the default; legacy libSQL remains supported. Small transactions are used, while large transaction loops are avoided for Windows stability. | Keep the owner-turn transaction constant-size and prove it against both storage backends before expanding the feature. |
| Lorebook processing | Lorebook activation already supports explicit chat IDs, keyword and semantic matching, macros, recursion, ordering, and prompt markers. Initial Game setup scans with no chat messages, so ordinary keyword entries do not directly ground the later map draft. | Add forced current-location candidates to the shared lorebook processor and give map drafting a separate explicit, bounded source-catalog path. Do not infer map canon from the world overview alone. |

### Target module map

New shared modules:

- `packages/shared/src/types/spatial-context.ts`: public definition, snapshot, transition, projection, response, warning, and error-code types.
- `packages/shared/src/schemas/spatial-context.schema.ts`: Zod schemas and all storage/request limits.
- `packages/shared/src/utils/spatial-context.ts`: pure graph indexing, validation, breadcrumb, reachability, archive checks, and deterministic destination sorting.
- `packages/shared/src/index.ts`: explicit exports for the new shared contract.

New server modules:

- `packages/server/src/db/schema/spatial-context.ts`: `spatial_context_snapshots` schema.
- `packages/server/src/services/storage/spatial-context.storage.ts`: snapshot reads, writes, branch copies, swipe shifts, command lookup, and cleanup.
- `packages/server/src/services/spatial-context/state-resolution.ts`: effective snapshot resolution for bootstrap, visible swipe, regeneration, branching, and checkpoints.
- `packages/server/src/services/spatial-context/projection.ts`: structured owner and connected projections plus bounded text formatting.
- `packages/server/src/services/spatial-context/owner-turn.ts`: validation and constant-size atomic move plus user-message commit.
- `packages/server/src/services/spatial-context/game-map-binding.ts`: authoritative breadcrumb projection plus explicit Game map, cell, and node binding resolution.
- `packages/server/src/routes/spatial-context.routes.ts`: dedicated GET and revisioned PUT routes.

New client modules:

- `packages/client/src/hooks/use-spatial-context.ts`: query keys, GET, definition PUT, conflict handling, and cache invalidation.
- `packages/client/src/features/spatial-context/SpatialContextSettingsSection.tsx`: compact Chat Settings summary and editor action.
- `packages/client/src/features/spatial-context/SpatialMapWorkspace.tsx`: lazy full-page editor shell.
- `packages/client/src/features/spatial-context/components/HierarchyNavigator.tsx`: hierarchy navigation and keyboard interactions.
- `packages/client/src/features/spatial-context/components/LocalMapCanvas.tsx`: positioned child-location map.
- `packages/client/src/features/spatial-context/components/LayerSelector.tsx`: ordered floor, tower, and dungeon layers.
- `packages/client/src/features/spatial-context/components/LocationInspector.tsx`: field editing, preview, links, archive controls, and inline validation.
- `packages/client/src/features/spatial-context/components/SpatialContextRuntimeBar.tsx`: breadcrumb, destination picker, pending state, and clear action.
- `packages/client/src/features/spatial-context/lib/editor-state.ts`: working-copy operations and server-error mapping. This remains client-local and is not exported through a barrel.

Existing integration files expected to change:

- Persistence: `packages/server/src/db/migrate.ts`, `packages/server/src/db/schema/index.ts`, `packages/server/src/db/file-backed-store.ts`, `packages/server/src/services/storage/chats.storage.ts`, and `packages/server/src/routes/backup.routes.ts` where required by table registration.
- Chat lifecycle: `packages/server/src/routes/chats.routes.ts`, `packages/server/src/routes/generate.routes.ts`, and `packages/shared/src/schemas/chat.schema.ts`.
- Prompt paths: `packages/server/src/routes/generate/dry-run-route.ts`, `packages/server/src/services/generation/game-gm-prompt-runtime.ts`, and the live-preview portion of `packages/server/src/routes/chats.routes.ts`.
- Lorebook grounding and activation: `packages/server/src/services/lorebook/`, `packages/server/src/routes/spatial-context.routes.ts`, `packages/client/src/features/spatial-context/components/LocationInspector.tsx`, the lorebook editor, and the Active Context UI.
- Client routing and send paths: `packages/client/src/stores/ui.store.ts`, `packages/client/src/stores/chat.store.ts`, `packages/client/src/components/layout/AppShell.tsx`, `packages/client/src/components/chat/ChatSettingsDrawer.tsx`, `packages/client/src/components/chat/ChatArea.tsx`, `packages/client/src/components/chat/ChatRoleplaySurface.tsx`, `packages/client/src/components/chat/ChatInput.tsx`, `packages/client/src/components/game/GameSurface.tsx`, and `packages/client/src/components/game/GameInput.tsx`.
- Portability and proof: native chat import/export code in `packages/server/src/routes/chats.routes.ts` and `packages/server/src/services/import/`, `scripts/regressions/`, `e2e/core-flows.e2e.ts`, and root `package.json` scripts.

The file list is a boundary, not a requirement to edit every file in one pull request. Each work package below should keep its diff focused.

### Persistence contract

Definitions remain inside chat metadata and are copied automatically when a branch copies chat metadata. Runtime state uses a separate table:

```ts
interface SpatialContextSnapshotRow {
  id: string;
  chatId: string;
  messageId: string;
  swipeIndex: number;
  currentLocationId: string | null;
  definitionRevision: number;
  source: "bootstrap" | "owner_turn" | "assistant_swipe" | "definition_repair" | "branch_copy";
  transitionCommandId: string | null;
  transitionPayloadHash: string | null;
  createdAt: string;
}
```

Required indexes and invariants:

- One effective row per `(chatId, messageId, swipeIndex)`.
- A transition command ID is unique within its chat when non-null.
- A repeated command ID with different destination, expected revision, or expected current location returns `409 spatial_transition_command_mismatch`.
- A repeated command ID with the same payload returns `409 spatial_transition_already_applied`, includes the committed snapshot and user-message ID, and performs no second write. The client reconciles from the response instead of resending the turn.
- Snapshot rows use stable location IDs. Renames and reparenting do not rewrite snapshots.
- A bootstrap row uses `messageId: ""` and swipe `0` until a committed message anchor exists.
- Deleting a chat, message, or swipe removes or shifts the matching spatial rows in the same places that currently maintain Game and turn-game snapshots.

The new table must be registered in the Drizzle schema, migration bootstrap, file-backed table list, cascade graph, profile backup/restore, and Mari DB integrity metadata. Legacy libSQL indexes must match file-native lookup behavior.

### Effective-state and history rules

Use one resolver for APIs, prompts, branching, and the client response:

1. If a specific message and swipe are requested, return that spatial snapshot.
2. For the current view, inspect the latest visible assistant message and its active swipe.
3. If that assistant swipe has no row, walk backward to the nearest user-turn or assistant snapshot in visible message order.
4. Fall back to the bootstrap row.
5. If no snapshot exists and the enabled definition has a valid starting location, return an in-memory starting state and materialize it on the first owner turn.

Owner-turn anchoring:

- Before persistence, resolve the source state from the currently visible history, not from the newest row by timestamp alone.
- In the atomic turn transaction, create the user message, initial swipe, chat timestamps, and an `owner_turn` spatial snapshot anchored to that user message.
- After an assistant response is saved, materialize the same state on its `(messageId, swipeIndex)` as `assistant_swipe`.
- A failed or aborted provider call leaves the accepted user turn and its spatial snapshot committed. Reload therefore shows the move and the saved user message, without inventing an assistant response.
- Regeneration resolves state immediately before the target assistant message and writes that state to the new swipe. Continuation retains the target swipe's state.
- Selecting a swipe changes the effective state through the existing active-swipe row. It does not rewrite other snapshots.
- Branch creation copies the definition, rekeys every copied spatial snapshot to the new message IDs, and includes the bootstrap row. An earlier-message branch stops copying at the selected cutoff.
- Game checkpoints store the applicable spatial snapshot ID or a stable copy of its current location and definition revision. Loading a checkpoint restores both Game state and spatial state.

Definition editing is not historical. A rename or reparent changes the breadcrumb rendered for old snapshots because the stable location ID is resolved against the branch's current definition. An old snapshot may refer to an archived location; it remains readable, but the next destination must be an active reachable node. If an editor archives the currently effective location, `replacementCurrentLocationId` is required and the server writes a `definition_repair` snapshot at the current visible anchor in the same transaction as the new definition revision.

### Atomic owner-turn sequence

Extend `generateRequestSchema` and the client generation contract with optional `pendingSpatialTransition`. It is accepted only for Roleplay and Game owner chats.

The server sequence is:

1. Acquire the existing per-chat generation lock.
2. Parse the request and load the chat inside the request lifecycle.
3. If there is no spatial transition, preserve the current message flow.
4. If a transition exists, start a constant-size database transaction.
5. Re-read the definition and visible state inside the transaction.
6. Validate owner mode, enabled state, expected definition revision, expected current location, command ID, destination status, and reachability.
7. Create the user message and initial swipe through a transaction-bound chat-storage instance.
8. Insert the spatial snapshot and update chat timestamps.
9. For Game, commit the visible Game snapshot in the same transaction where practical.
10. Commit, then continue attachment enrichment, persona snapshotting, prompt assembly, and provider work outside the transaction.

Validation failures occur before optimistic client state is treated as authoritative. A `400` graph or destination error and a `409` stale-state error contain stable machine codes, safe user-facing text, current revision, and current breadcrumb. They never include hidden or blocked destination names.

The client retains the submitted text, attachments, and pending destination until the server accepts the turn. On a conflict it removes the optimistic message, refreshes the Spatial Context query, restores the draft, and offers `Review destinations`. On acceptance it clears all three together.

### Shared projection contract

The resolver returns structured data before any prompt text is produced:

```ts
interface ResolvedOwnerSpatialProjection {
  kind: "owner";
  chatId: string;
  ownerMode: SpatialOwnerMode;
  definitionRevision: number;
  currentLocationId: string;
  breadcrumb: Array<{ id: string; name: string }>;
  description: string;
  modelMemory: string | null;
  lorebookEntryIds: string[];
  destinations: Array<{ id: string; name: string; label?: string }>;
  omittedDestinationCount: number;
}
```

Prompt limits are separate from storage limits:

- At most 20 breadcrumb nodes.
- At most 4,000 characters of owner description.
- At most 8,000 characters of private model memory.
- At most 50 destinations in deterministic `sortOrder`, name, then ID order, followed only by an omitted count.
- At most 50 current-location lorebook references before the lorebook processor applies entry and token budgets.
- At most 1,000 characters for a connected `awarenessSummary` or fallback public-description excerpt.

One formatter produces the shared structured owner block. Roleplay and Game use thin adapters around that block. The formatter never serializes `lorebookEntryIds`; the owner prompt pipeline consumes them through the lorebook processor. A second formatter, introduced only in Phase 3, produces the privacy-reduced Conversation block and receives no location-lore field.

Every live path calls the same resolver and formatter immediately before final model-request preparation:

- Standard Roleplay generation.
- Game GM generation.
- `/api/generate/dryRun`.
- Live Peek Prompt assembly when no exact saved request exists.
- Retry and continuation paths that rebuild a prompt.

Exact cached Peek Prompt needs no new assembly. It displays the already-saved provider request, which must contain the spatial block used for that swipe. Regression coverage must compare normalized spatial blocks across live generation, dry run, and live Peek Prompt for the same fixture.

### Lorebook-grounded draft contract

Map grounding is an explicit authoring input:

```ts
interface SpatialMapGroundingRequest {
  mode: "setup_only" | "lore_strict" | "lore_expand";
  lorebookIds: string[];
  entryIds?: string[];
}
```

Game setup defaults `lorebookIds` from `GameSetupConfig.activeLorebookIds`. Roleplay defaults them from the chat's active global, linked, and pinned books. The creator can change the selection before generation. Disabled or explicitly excluded books and entries are never sent.

This is not a lorebook activation scan. The server reads the selected sources directly, resolves supported macros against the owner setup context without persisting the resolved text, and builds a catalog containing:

- Temporary source key
- Entry and lorebook names
- Activation keys and tags
- Entry description when present
- Otherwise, a bounded content excerpt

The catalog is limited by the smallest of 100 entries, 16,000 characters, and the connection context remaining after reserving setup, system, and requested output space. Priority is deterministic:

1. Explicitly selected `entryIds`.
2. Entries with location-like tags, names, or keys.
3. Entries with authored descriptions.
4. Remaining entries in stable lorebook and entry order.

If entries are omitted, the preview reports the count and offers Refine sources. It never implies that the whole lorebook was considered.

The simplified model plan adds temporary source keys to each proposed location. The server rejects unknown keys, maps valid keys to stable entry IDs, removes duplicates, and computes preview provenance:

- `Lore-backed`: at least one validated source entry.
- `Inferred`: a relationship or container derived from source material but not represented as its own source entry.
- `Added by AI`: no source entry supports the node.

`lore_strict` rejects every node without a validated source key. `lore_expand` accepts inferred and added nodes but labels them visibly. A valid source key proves provenance, not semantic fidelity; the preview must show source excerpts so the creator can catch a misread relationship or name before Apply.

The generate endpoint returns the normalized draft definition plus a transient provenance map keyed by generated location ID. Only `lorebookEntryIds` persist after Save. Replace and expand retain the existing history protections; expansion may add bindings to new nodes but cannot rewrite existing locations or bindings.

### Game compatibility boundary

When Spatial Context is enabled for a Game chat:

- `SpatialContextSnapshot.currentLocationId` is authoritative.
- Game state `location` is a compatibility projection only.
- Game-state GET responses and tracker UI receive the resolved breadcrumb as the displayed location.
- World State agent patches and manual Game tracker patches cannot independently write `location`; the server drops that field with a debug diagnostic or returns a field-level conflict for explicit manual edits.
- New Game snapshots mirror the breadcrumb into their legacy `location` value so session history and existing UI remain readable, but prompt code still reads the spatial projection.
- A Game map, grid cell, or node may bind explicitly to a stable hierarchy location ID.
- Selecting a bound destination creates a structured pending spatial transition and does not insert movement prose.
- Unbound cell and node movement remains tactical and changes only party position.
- Entering a bound location selects its local map when available; leaving selects the closest bound ancestor map when available.
- The UI labels the systems distinctly as `Story location` and `Map position` when both are visible.
- Disabling Spatial Context immediately restores current legacy Game location behavior without deleting spatial definitions or snapshots.

Negative controls must prove that a model-emitted Game location patch, a manual tracker edit, and an unbound map click cannot change `currentLocationId`. Positive controls prove that a valid bound click uses the normal transition validator.

### Owner UI contract

Chat Settings adds one compact `Hierarchical Map` section for Roleplay and Game only. It shows enabled state, current breadcrumb, active and archived counts, warning count, and `Open Map Editor`. It does not embed the full editor in the drawer.

The Location Editor follows the existing full-page editor route:

- Desktop uses a hierarchy navigator, local map or layer view, and selected-location inspector.
- Mobile shows the hierarchy first and details second, with a visible Back to locations action. No operation depends on hover or drag.
- Rows expose add child, add sibling, reparent, duplicate subtree, archive, and link actions through labelled controls.
- The local view renders children as positioned map nodes, ordered layers, or an accessible list.
- Selecting previews a location; a distinct Enter action navigates to it.
- The inspector contains name, kind, public description, private model memory, icon, presentation, placement or layer order, status, parent, direct links, and linked lore.
- Linked lore uses an inline searchable disclosure rather than a blocking modal. Results group entries by lorebook and expose disabled or excluded state before attachment.
- Attached rows provide Open entry and Detach. Detach never deletes lore, and duplicate subtree copies bindings.
- The lorebook editor shows current-chat map backlinks so a creator can find every location using an entry.
- AI draft controls show source books, grounding mode, considered and omitted entry counts, and provenance without requiring technical prompt knowledge.
- Validation is inline and also summarized near Save. Selecting a summary item focuses the affected node and field.
- The editor uses a local working copy and one revisioned Save action. `editorDirty` protects navigation. Server conflicts preserve the working copy and offer Reload server version or Review differences; there is no blind overwrite.
- Empty state teaches the first action: `Create a starting location`. Enabling is unavailable until a valid active starting location exists.
- Loading uses the existing editor skeleton vocabulary. Save, conflict, archived, hidden, blocked, and invalid states use text or icons in addition to color.

Owner chat surfaces share `SpatialContextRuntimeBar`:

- The persisted breadcrumb is visible above or beside the input without covering story content.
- The destination picker lists parent, children, and direct links in labelled groups while preserving deterministic order.
- Selecting a destination creates a clearly labelled pending chip. It does not move state immediately.
- The chip can be cleared and survives chat switching or reload with the text draft.
- Sending may contain text, attachments, or only a pending destination. The transition is request data and is not appended to visible message text.
- A stale pending destination stays visible after conflict, marked `Needs review`, until the user selects a valid replacement or clears it.
- On narrow screens the breadcrumb truncates in the middle, retains the current location name, and exposes the full path through an accessible disclosure.

The editor and runtime controls use existing semantic theme tokens, support dark, light, and SillyTavern themes, maintain 44px touch targets for primary mobile actions, and include visible focus states. Motion is limited to 150 to 250 ms state transitions and never moves layout purely for decoration.

### Portability and lifecycle coverage

Native Marinara chat export must carry:

- The current definition in `marinara_metadata`.
- Spatial snapshots keyed by exported message ordinal and swipe index, not by display names.
- The bootstrap snapshot when present.

Import creates new chat, message, and snapshot IDs while preserving location IDs inside the definition. Malformed imported graphs disable Spatial Context, preserve the raw definition for repair, and return warnings. They are never silently name-matched or partially activated.

Chat JSONL export preserves location-to-entry IDs because they are part of the definition, but it does not silently bundle lorebook content. Import resolves references against the destination profile and reports missing entries as repairable warnings without name matching. Profile backup and restore preserve working references because they carry both spatial definitions and lorebook tables. A future explicit campaign package may bundle referenced lorebooks for cross-profile portability.

Profile backup and restore include the new table through `FILE_BACKED_TABLES`. Chat deletion, bulk deletion, expunge, branch deletion, swipe deletion, and message deletion follow the existing cascade and application-cleanup paths. Existing chats need no eager migration because absent metadata means disabled Spatial Context.

### Work packages and merge order

#### Package A: core contract and proof spike

- Add shared types, schemas, pure graph helpers, limits, fixtures, and stable error codes.
- Add a temporary proof harness for constant-size transactions against file-native storage and legacy libSQL. Do not keep `.test.ts` files.
- Prove the state resolver with bootstrap, visible swipe, earlier branch point, archived historical current, and stale-definition fixtures.
- Measure projection sizes for shallow, depth-20, wide-500, long-text, and linked graphs.

Gate: graph semantics, projection bounds, snapshot anchors, and transaction feasibility are demonstrated before UI work starts.

#### Package B: definition API and storage

- Add schema, migration, file-backed registration, storage adapter, GET, and revisioned PUT.
- Add current-location replacement for archive operations.
- Wire deletion, swipe shifting, and profile backup/restore.
- Add server regression coverage for revision conflicts, invalid graphs, hidden errors, and command reuse.

Gate: definitions and snapshots round-trip on both storage backends and invalid writes leave no partial state.

#### Package C: owner-turn history integration

- Extend the generation request with `pendingSpatialTransition`.
- Add atomic owner-turn persistence and assistant-swipe materialization.
- Integrate regeneration, continuation, active swipes, branches, and Game checkpoints.
- Add native chat export/import of definitions and snapshots.

Gate: reload, provider failure, swipe changes, earlier-message branching, import/export, and checkpoint restore resolve the expected location.

#### Package D: prompt projection and Game authority

- Add structured projection and bounded formatters.
- Integrate live generation, Game GM, dry run, live Peek Prompt, retries, and continuations.
- Enforce the Game compatibility boundary and tracker breadcrumb display.
- Add privacy and inactive-location negative controls.

Gate: all prompt paths contain the same spatial block, no unrelated location text leaks, and Game cannot maintain a competing authoritative location.

#### Package E: map browser and editor

- Add React Query hooks, conflict mapping, settings summary, and lazy editor route.
- Add hierarchy, local map, layer, list, preview, inspector, and duplicate-subtree workflows.
- Add accessible desktop and mobile states.
- Preserve unsaved edits across revision conflicts.

Gate: creators can build and repair nested maps without drag, hover, or precision input.

#### Package E.1: AI-assisted map drafting

- Add an on-demand setup-time generator that uses bounded Game or Roleplay setup context, never implicit turn-time mutation.
- Generate a simplified keyed map plan, then assign stable IDs, repair safe layout omissions, and validate the complete definition server-side.
- Preview the generated hierarchy as a local draft before replacing editor state.
- Require explicit Apply and Save actions; generation never enables Spatial Context or writes a definition by itself.
- Keep ordinary conversation history out of the generation prompt and expose final prompts through debug logging.

Gate: a nontechnical creator can describe a world, receive a valid nested map, inspect it, and decline or apply it without changing persisted state until Save.

#### Package E.1.1: history-safe AI map expansion

- Treat whole-map AI creation as a pre-campaign workflow. Once message-linked spatial history exists, preserve every existing location ID server-side.
- Replace the active-campaign generator with an add-only expansion workflow scoped to a selected active location.
- Preserve the current location, starting location, existing descriptions, links, layout, archived nodes, and future Game bindings. Assign new stable IDs only to added locations.
- Keep expansion based on bounded setup and selected-location context, not ordinary turn history.
- Preview new locations as a local draft and retain the existing Apply and Save boundary.
- Allow whole-map replacement only before committed spatial history exists, with expansion as the safer default when a map is already present.

Gate: AI can grow an active campaign map without orphaning turn snapshots, changing current location, or replacing existing IDs.

#### Package E.2: Game setup wizard map option

- Add an optional `Draft a hierarchical world map` choice to the existing Features step, with a simple size selection.
- Run map generation only after `/game/setup` persists the world overview and story arc. A gameplay turn is not required.
- Keep setup visibly busy while the follow-up draft is generated, including after a repaired setup payload is applied.
- Open the normal AI preview and map editor after generation. Skip returns to the game, Apply changes only the working copy, and Save remains the persistence boundary.
- If map generation fails, preserve the successfully created game, explain the failure, and let the creator build a map later from Chat Settings.
- Do not embed the full map editor into the narrow setup wizard or silently enable and persist a generated definition.

Gate: a creator can request a richer initial map during setup without generating from incomplete local wizard state or bypassing review.

#### Package F: Roleplay and Game runtime UI

- Add the shared runtime bar and per-chat pending-transition persistence.
- Integrate Roleplay and Game send paths without altering visible message text.
- Add explicit Game map, cell, and node binding controls.
- Select bound maps after accepted transitions while preserving unbound tactical movement.

Gate: Roleplay and Game can move, recover from stale state, reload, switch chats, and use the feature with keyboard and touch.

#### Package F.1: location lorebook bindings and runtime activation

- Extend the shared schema and editor working copy with bounded `lorebookEntryIds`.
- Add inline map attachment controls, lorebook backlinks, and broken-reference warnings.
- Extend shared lorebook processing with forced candidate IDs, activation-source deduplication, exclusions, and the reserved location-lore cap.
- Integrate the same resolver into Roleplay, Game GM, dry run, and live Peek Prompt paths.
- Add Active Context source and truncation reporting.
- Preserve reference IDs through branch and JSONL export/import flows, and warn when destination lore is missing.

Gate: moving between locations activates only the destination's enabled attached lore in every owner prompt path, with no duplicate injection or Conversation leakage.

#### Package F.2: lorebook-grounded map drafting

- Add grounding mode and explicit source selection to create, replace, and expand requests.
- Build the bounded source catalog from selected lorebooks, not ordinary chat scanning.
- Validate temporary source keys and auto-bind valid entries to generated nodes.
- Show Lore-backed, Inferred, and Added by AI provenance with source inspection in the draft preview.
- Enforce source-backed nodes in Strict canon and visible unsupported additions in Canon with expansion.
- Preserve history-safe add-only expansion and the existing Apply then Save review boundary.

Gate: selected lorebook facts ground the generated hierarchy directly, every unsupported location is visible before Save, and strict mode cannot persist an unreferenced generated node.

#### Package G: connected Conversation

- Implement only after Packages A through F.2 are stable.
- Resolve the linked owner at generation time and use the reduced projection formatter.
- Add conservative presence wording and read-only UI.
- Prove unlink, relink, deleted owner, malformed reciprocal links, cycles, and concluded story behavior.

Gate: Conversation never receives private model memory, internal IDs, hidden destinations, location-attached lore IDs or content, or mutation capability.

Model-requested movement, creator templates, portable campaign packages, and per-character positions remain separate later packages after the owner and lorebook-grounding work ships.

### Issue and pull-request boundaries

This is a large feature under the repository workflow. Before Package A implementation begins:

1. Confirm or open the single tracking issue and make ownership visible there.
2. Check for an existing issue-linked branch, draft pull request, or project-board item.
3. Open a draft pull request against `staging` as soon as implementation starts.
4. Use the work packages as reviewable PR boundaries when practical; do not combine the owner MVP and connected Conversation merely to reduce PR count.

Suggested issue split:

1. Spatial Context shared core, persistence, and definition API.
2. Owner-turn snapshots, swipes, branches, checkpoints, and portability.
3. Owner prompt projection and Game compatibility.
4. Owner editor and runtime movement UI.
5. Location lorebook bindings and owner runtime activation.
6. Lorebook-grounded map drafting.
7. Connected Conversation read-only projection.
8. Model-requested movement.

### Proof matrix

| Claim | Automated proof | Manual proof |
| --- | --- | --- |
| Location lore activation is exact and bounded | Fixtures cover accepted movement, pending and rejected movement, disabled and excluded entries, duplicate activation sources, token truncation, reload, swipes, and branches | Move between two differently linked locations in Roleplay and Game, then inspect Active Context and Peek Prompt |
| Lorebook grounding is inspectable | Strict-mode fixtures reject unreferenced nodes; expansion fixtures preserve validated source keys and label unsupported nodes; catalog caps and omission counts are deterministic | Draft from a large existing lorebook, open source excerpts, compare Strict canon and Canon with expansion, and reject an invented location |
| Graph validation is deterministic | Dedicated spatial regression script with positive and negative fixtures | Inspect inline editor errors for representative invalid nodes |
| Move and user message are atomic | Injected storage failure before and after each transaction write on both backends | Force a stale revision while a draft and destination are pending |
| History restores the right location | Snapshot regression covering reload, swipes, regeneration, branch cutoff, and checkpoint | Exercise each flow in Roleplay and Game |
| Prompt paths agree | Compare normalized blocks from generation helper, dry run, and live Peek Prompt | Inspect Peek Prompt and debug output for one chat per owner mode |
| Context stays bounded | Wide and long-text fixtures assert character and destination caps | Inspect a deep and wide hierarchy in the editor and destination picker |
| Privacy holds | Negative assertions for private memory, hidden links, inactive nodes, unrelated descriptions, and location-attached lore IDs and content | Link a Conversation chat and inspect its prompt in Phase 3 |
| Game has one location authority | Reject legacy patches; validate bound transitions; preserve unbound movement | Try tracker edit, bound and unbound map moves, checkpoint load, enable, and disable |
| UI is resilient | Playwright flow for create, edit, pending move, conflict, and mobile navigation | Verify dark, light, SillyTavern, keyboard, touch, long names, and empty states |
| Portability preserves IDs and state | Native export/import and profile backup/restore round trips cover spatial bindings; missing destination lore produces warnings | Export a branched chat, import it with and without its lorebooks, and inspect the breadcrumb, history, bindings, and warnings |

Add `scripts/regressions/spatial-context.regression.ts` and a `regression:spatial` package script, then include it in `pnpm regression`. Do not add permanent `.test.ts` files. Each implementation PR still runs the narrow spatial regression plus the repository checks appropriate to its scope.

## Acceptance criteria

- A map location stores lorebook entry references, never copied lore content.
- Only the accepted exact current location force-activates attached lore, subject to disabled, exclusion, deduplication, ordering, entry-limit, and token-budget rules.
- Active Context identifies current-location activation, combined activation sources, and deterministic truncation.
- Grounded drafting reads explicitly selected lore entries directly rather than depending on keyword scans or generated world-overview summaries.
- Strict canon produces only source-backed locations; Canon with expansion labels every inferred or unsupported addition before Save.
- Connected Conversation receives no location-attached lore IDs or content.
- Rename and reparent operations preserve location identity.
- Invalid graphs and stale writes never mutate state.
- Movement commits with a user turn or not at all.
- Reload, swipe selection, earlier-message branching, and Game checkpoint restore resolve the correct location.
- Owner prompts contain only active-location context and valid destinations.
- Game does not display or prompt from a competing free-text location when enabled.
- Existing Game maps can bind explicitly to hierarchy locations without breaking tactical movement.
- Roleplay and Game use the same hierarchy and transition rules.
- Dry-run and Peek Prompt use the same projection behavior as generation.
- Existing chats and disabled Spatial Context retain current behavior.
- Conversation cannot own or mutate spatial state.
- Private model memory never enters Conversation projection.

## Validation

Deterministic coverage must include graph limits, cycles, navigation directions, hidden and blocked links, stale revisions, idempotency, branch points, swipes, checkpoints, lorebook reference limits, forced activation, exclusions, deduplication, token truncation, grounding catalog caps, source-key validation, strict-mode rejection, provenance, privacy boundaries, and inactive-location negative controls.

Repository checks:

```bash
pnpm check
pnpm regression:prompt
pnpm smoke:ui
```

Manual verification covers desktop and mobile authoring, deep breadcrumbs, layers, positioned maps, long names, conflict recovery, archive protections, Roleplay, Game, bound and unbound map movement, reload, branching, checkpoint restore, linked-lore attachment and backlinks, disabled and broken references, large-source omission warnings, Strict canon and Canon with expansion previews, Active Context, and Peek Prompt. PR validation checkboxes remain unchecked for human verification.

## Deferred

- Immediate movement without a chat turn
- Independent character positions
- Generic flags, events, or scripts
- Location templates and scenario packages
- Per-character spatial knowledge
- Shareable location lore in Conversation
