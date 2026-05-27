# Refactor Parity Pipeline

This tracker is the working ledger for bringing the Tauri refactor branch back to Marinara Engine v1.6.1 functionality. The reference behavior is the current `main` line at v1.6.1; the implementation target is `refactor`.

## Ground Rules

- Port behavior, not the old Node runtime. Browser/client behavior belongs in `src/features`, domain behavior in `src/engine`, shared host adapters in `src/shared/api`, and privileged/native behavior in `src-tauri`.
- Keep chat, roleplay, and game mode ownership separate unless there is an existing shared abstraction.
- Prove each migrated feature with a focused check before marking it complete.
- Prefer lazy, requested-only loading. Opening one chat, roleplay, or game must not load unrelated conversations or heavyweight history.
- Do not hide failures behind fake success states. If a Tauri capability is missing or unsupported, surface a precise error.

## Loop

For each feature slice:

1. Investigate the v1.6.1 behavior and the current refactor behavior.
2. Implement the missing or broken behavior in the correct Tauri/refactor layer.
3. Verify with focused automated checks and, where needed, app-level manual testing.
4. Mark the slice complete or document the remaining gap before moving on.

## Initial Findings

- Embedded Tauri IPC currently has handlers for every frontend `invokeTauri` command found in `src`.
- Hostable remote runtime coverage is incomplete. Many embedded commands are not in the remote allowlist or HTTP dispatcher yet.
- Initial chat message loading is already paginated through `list_messages_for_chat_page`; freezes are likely caused by adjacent bulk reads, invalidations, derived counts, imports, deletes, or focus/refetch behavior rather than the first message page alone.
- Refactor has a TypeScript generation spine and Rust/native capability wrappers, but agents, streaming, prompt assembly, game mode, autonomous behavior, and imports still need proof against v1.6.1.

## Parity Ledger

| Slice | Scope | Status | Proof |
| --- | --- | --- | --- |
| Runtime substrate | Embedded command coverage, remote command coverage, capability boundaries | In progress | Embedded coverage checked: no missing frontend handlers. Remote coverage still partial. |
| Profile/data migration | Import v1.6.1 chats, messages, characters, settings, presets, personas, agents, memories, assets | In progress | Legacy connected conversation notes and OOC influences now import into target chat notes. Rust test added but local `cargo` is unavailable here. |
| Chat/generation performance | Lazy chat open, deletion, list summaries, focus/refetch behavior, generation message loading | In progress | Normal generation now loads a bounded recent history window instead of the full chat; regeneration still loads broadly so old targets remain addressable. |
| Generation spine | Streaming, cancellation, prompt assembly, history roles, preset formatting, summaries, regex | In progress | Connected conversation prompt injection ported; stored chat/game generation parameters now merge into LLM requests. Focused tests pass. |
| Agents | Agent enablement, prompt injection, tool calls, custom tools, agent memory/runs, UI state | In progress | Custom script tools restored; chat-scoped built-in fallback agents now resolve without DB rows and per-chat selection overrides disabled global rows. Focused tests pass. |
| Roleplay | Roleplay prompt assembly, typewriter streaming, character roles, scene/encounter/tracker hooks | In progress | Expression avatars restored; streaming views now read per-chat buffers. Need app/browser pass. |
| Game mode | Game services, start path, turn generation, repair flow, UI state, assets | In progress | Start guard restored and game turns now inherit stored generation parameters. Focused generation tests pass. |
| Autonomous conversation | Client polling, background cadence, idle behavior, schedules, error display | Not started | Need focused tests and app run. |
| Professor Mari | Persistent history, connection/tool requirements, compaction, loading state, animation | In progress | History no longer flashes welcome before load; persona and connection preferences persist; compaction/history tests pass. Need app/browser pass. |
| UI parity | Stale controls, input buttons, loading surfaces, status indicators | In progress | Chat bulk export format menu and several missing settings restored. Need app/browser pass. |
| Integrations | TTS, haptics, Spotify, knowledge sources, GIFs, image generation, sprites | In progress | Spotify mini player and TTS audio format restored; frontend checks pass. Need Rust check once Cargo is available. |

## Active Slice

`Connected conversation notes/influences` was the first completed parity slice because it crossed migration, prompt assembly, and generation behavior:

- Conversation `<note>` and `<influence>` tags are stored on the linked roleplay/game chat instead of being stranded on the source conversation.
- Roleplay/game prompt assembly injects durable notes and unconsumed one-shot influences using the v1.6.1 XML blocks.
- One-shot influences are marked consumed after they enter the prompt.
- Legacy `conversation_notes` and `ooc_influences` tables import into the target chat's `notes` array.

Next active slice: continue `Profile/data migration` by checking legacy `assets` rows and then move into `Game mode start/turn parity`.

## Completed Slice: Bounded Generation History Load

Normal generation no longer asks storage for every message in a chat before prompt assembly. It now loads a bounded recent window based on `historyLimit` plus a small margin, matching the maximum prompt history the assembler can use. Regenerating an old assistant message still loads without the bound because it may need to find an older target.

## Completed Slice: Settings And Tool Parity Batch

This batch restored several v1.6.1 surfaces that had regressed in the Tauri refactor:

- TTS audio format is back in settings and the Rust TTS proxy now forwards MP3/WAV to OpenAI-compatible and local TTS providers.
- OpenRouter service tier is back in generation parameters and is sent as `service_tier` for OpenRouter requests.
- Expression avatars are back for roleplay message rendering, with the duplicate expression sprite hidden from the VN overlay when enabled.
- Selected chats can export JSONL ZIP, Text ZIP, or native Marinara JSON from the sidebar.
- Custom script tools can be saved, selected, advertised to models, and executed in the Tauri TypeScript runtime.

## Completed Slice: Professor Mari Loading And Generation Parameters

This slice tightened the next broken user-facing paths:

- Professor Mari waits for stored history before rendering the welcome message, shows an app-styled restoring state, and keeps her sprite animated while loading.
- Professor Mari now persists the quick persona selection with the selected model connection and keeps input disabled until both history and preferences are ready.
- The shared generation engine now merges connection defaults, game setup parameters, game metadata parameters, per-chat parameters, and per-request parameters into the outgoing LLM call.
- Roleplay streaming/regeneration views read per-chat stream and thinking buffers so switching away and back does not lose typewriter text.
- Game start now rejects invalid session states, avoids duplicate intro generation when a GM turn already exists, and game user turns honor the global quote-format setting.

## Completed Slice: Agent Activation Fallbacks

The Tauri runtime now matches the important v1.6.1 agent behavior for chat-scoped built-ins:

- Built-in agents explicitly listed in a chat's `activeAgentIds` run even when no saved `agents` config row exists yet.
- A per-chat active agent selection overrides a disabled global config row, so disabling an agent globally does not silently suppress a chat that explicitly enabled it.
- Manual agent retries can resolve built-in fallback configs when only an agent type is requested.
- Synthetic fallback configs use the built-in default settings and default tool list, then fall back to the chat connection/model just like v1.6.1.
