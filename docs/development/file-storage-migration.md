# File Storage Migration (Developers)

This is developer and reviewer material, not an end-user guide. It explains how Marinara Engine moved user data off a live SQLite database and onto JSON file snapshots. It also covers the one-time legacy import and where the durable files live. If you just want to know where your data sits on disk, read the user guide linked at the bottom instead.

## Why file storage replaced the live database

Marinara Engine v1.5.7 moved user data away from a persistent SQLite database file. The durable source of truth is now a set of JSON files under `DATA_DIR/storage`. The live runtime uses a file-native store that holds tables in memory and writes dirty tables back to JSON. SQLite is no longer opened after the one-time legacy import finishes.

The goal was to remove live SQLite and database migrations from the user-facing data path. The trade-off is intentional and conservative. It keeps the existing internal query APIs while changing only where rows are persisted.

## The default backend

The storage backend is selected in `packages/server/src/config/runtime-config.ts`. The default is `files`. You can read the resolved value from `getStorageBackend()`, and `isFileStorageBackend()` returns true unless the backend is `sqlite`.

Because file storage is the default, a normal install never runs database migrations at startup. In `packages/server/src/app.ts`, `runMigrations(db)` runs only when `isFileStorageBackend()` is false. Contributors do not need to run `pnpm db:push`, `pnpm db:migrate`, or any other database command for a file-storage install.

## What happens on startup

The startup logic lives in `FileTableStore.initialize()` in `packages/server/src/db/file-backed-store.ts`. It decides between four paths, in this order.

1. If `storage/manifest.json` exists, Marinara loads the JSON table files into the in-memory store. It then runs a legacy repair check (see below).
2. If there is no manifest but a legacy `marinara-engine.db` exists, Marinara imports every persisted table from that database one time. It then writes the full `storage` directory.
3. If there is no manifest and no legacy database, but a `storage/tables/` directory exists, Marinara loads the existing JSON files.
4. If none of the above exist, the store starts empty.

The one-time import reads every domain table, including Conversation, Roleplay, Game, agents, lorebooks, prompts, connections, galleries, memories, and settings. After import, new writes autosave back to JSON files. The old `.db` file is left in place as a recovery artifact and is never deleted. The import only reads from the old database and never writes to it. (Only the `node:sqlite` fallback reader opens the file with an explicit read-only flag.)

### Legacy repair after a partial import

Even after the manifest is written, the legacy database can still sit next to the file store. If it does, `repairLegacyImportIfNeeded()` runs on the next startup and checks whether the recorded repair is complete. If it is not, Marinara re-reads the legacy database. It back-fills any rows whose primary keys are missing from the file store. This protects against a first import that was interrupted before it finished. A completed repair is recorded in the manifest so the back-fill does not repeat every startup.

## The storage layout on disk

The default layout looks like this. `DATA_DIR` resolves through `getDataDir()`, and the `storage` directory can be relocated with `FILE_STORAGE_DIR`.

```text
DATA_DIR/
  storage/
    manifest.json
    tables/
      chats.json
      messages.json
      ...
```

Each entry in `FILE_BACKED_TABLES` maps to one file at `storage/tables/{table}.json`. Every table file holds a JSON array of that table's rows. A matching `.bak` copy is kept for crash recovery. Writes are atomic: write to a temporary file, fsync, then rename.

This table-snapshot layout is deliberately flat. A later cleanup can split large tables into domain-native files such as `chats/{chatId}/messages.ndjson` and `characters/{characterId}/card.json`. That is future work.

## The manifest file

`storage/manifest.json` is the marker that a completed file store exists. It is written by `saveFileSnapshots()` and currently uses `version: 2` with `backend: "file-native"`. The manifest records:

- `version` and `savedAt`: the storage format version and the last save time.
- `tables`: a map of table name to row count, written on every save.
- `migratedFromSqlite`: the legacy database path or paths and the import timestamp, present only after a one-time import.
- `legacyRepair`: the repair timestamp, the reader used, and per-table repair counts. The initial import also writes this block as a completion marker, with empty per-table counts. Counts become non-zero only when a later repair pass back-fills rows.

The manifest can be rebuilt from the on-disk table files, so a corrupted manifest does not block startup. Marinara falls back to `manifest.json.bak`, then to an empty manifest, and rewrites a fresh one on the next save.

## Autosave and durability

The store never writes on every mutation. Instead `markDirty()` records which tables changed and schedules a debounced flush. The relevant timings in `file-backed-store.ts` are:

- A debounced save about 750 milliseconds after the first write that marks the store dirty. The timer is set once and is not extended by later writes in the same window.
- A safety save on a 10 second interval.
- A final flush on process `beforeExit` and on `closeDB()`.

Only dirty tables are rewritten. Backups include the whole `storage` directory, so a backup taken while the server is stopped captures a consistent snapshot.

## The persisted tables

The authoritative list is `FILE_BACKED_TABLES` in `packages/server/src/db/file-backed-store.ts`. Do not hardcode a table count in prose, because the list grows as features are added. New releases add files under `storage/tables/` without changing the shape. The table below reflects the current list.

| Table | Durable file | Domain |
| --- | --- | --- |
| `chats` | `storage/tables/chats.json` | Chat metadata for Conversation, Roleplay, and Game |
| `messages` | `storage/tables/messages.json` | Chat transcripts |
| `message_swipes` | `storage/tables/message_swipes.json` | Regenerated and alternate message swipes |
| `conversation_call_sessions` | `storage/tables/conversation_call_sessions.json` | Conversation call sessions |
| `conversation_call_messages` | `storage/tables/conversation_call_messages.json` | Conversation call transcripts |
| `conversation_call_sounds` | `storage/tables/conversation_call_sounds.json` | Uploaded call soundboard assets |
| `characters` | `storage/tables/characters.json` | Character cards |
| `character_card_versions` | `storage/tables/character_card_versions.json` | Character card version history |
| `personas` | `storage/tables/personas.json` | User personas |
| `persona_card_versions` | `storage/tables/persona_card_versions.json` | Persona version history |
| `character_groups` | `storage/tables/character_groups.json` | Character folders |
| `persona_groups` | `storage/tables/persona_groups.json` | Persona folders |
| `noodle_accounts` | `storage/tables/noodle_accounts.json` | Noodle social accounts |
| `noodle_posts` | `storage/tables/noodle_posts.json` | Noodle timeline posts |
| `noodle_interactions` | `storage/tables/noodle_interactions.json` | Noodle likes and comments |
| `noodle_activity_digests` | `storage/tables/noodle_activity_digests.json` | Noodle activity digests |
| `noodle_refresh_runs` | `storage/tables/noodle_refresh_runs.json` | Noodle refresh run history |
| `lorebooks` | `storage/tables/lorebooks.json` | Lorebook metadata |
| `lorebook_character_links` | `storage/tables/lorebook_character_links.json` | Lorebook to character links |
| `lorebook_persona_links` | `storage/tables/lorebook_persona_links.json` | Lorebook to persona links |
| `lorebook_folders` | `storage/tables/lorebook_folders.json` | Lorebook folders |
| `lorebook_entries` | `storage/tables/lorebook_entries.json` | Lorebook entries and vector metadata |
| `prompt_presets` | `storage/tables/prompt_presets.json` | Prompt preset metadata |
| `prompt_groups` | `storage/tables/prompt_groups.json` | Prompt section groups |
| `prompt_sections` | `storage/tables/prompt_sections.json` | Prompt sections |
| `choice_blocks` | `storage/tables/choice_blocks.json` | Preset variables and choice blocks |
| `api_connections` | `storage/tables/api_connections.json` | LLM, image, video, embedding, and TTS connections |
| `assets` | `storage/tables/assets.json` | Generated and default asset metadata |
| `agent_configs` | `storage/tables/agent_configs.json` | Built-in and custom agents |
| `agent_runs` | `storage/tables/agent_runs.json` | Agent output history |
| `agent_memory` | `storage/tables/agent_memory.json` | Per-agent chat memory |
| `custom_tools` | `storage/tables/custom_tools.json` | User-defined tools |
| `game_state_snapshots` | `storage/tables/game_state_snapshots.json` | Game turn state snapshots |
| `game_engine_state` | `storage/tables/game_engine_state.json` | Game engine runtime state |
| `game_checkpoints` | `storage/tables/game_checkpoints.json` | Game checkpoints |
| `game_scene_videos` | `storage/tables/game_scene_videos.json` | Game and scene video metadata |
| `game_turn_storyboards` | `storage/tables/game_turn_storyboards.json` | Game storyboard metadata |
| `game_turn_storyboard_keyframes` | `storage/tables/game_turn_storyboard_keyframes.json` | Storyboard keyframes |
| `regex_scripts` | `storage/tables/regex_scripts.json` | Regex scripts |
| `chat_images` | `storage/tables/chat_images.json` | Chat gallery image metadata |
| `character_images` | `storage/tables/character_images.json` | Character gallery image metadata |
| `persona_images` | `storage/tables/persona_images.json` | Persona gallery image metadata |
| `gallery_folders` | `storage/tables/gallery_folders.json` | Gallery folders |
| `global_images` | `storage/tables/global_images.json` | Global gallery images |
| `custom_emojis` | `storage/tables/custom_emojis.json` | Custom emoji assets |
| `custom_stickers` | `storage/tables/custom_stickers.json` | Custom sticker assets |
| `ooc_influences` | `storage/tables/ooc_influences.json` | Cross-chat influence notes |
| `conversation_notes` | `storage/tables/conversation_notes.json` | Conversation carryover notes |
| `memory_chunks` | `storage/tables/memory_chunks.json` | Vector memory chunks |
| `chat_folders` | `storage/tables/chat_folders.json` | Chat sidebar folders |
| `api_connection_folders` | `storage/tables/api_connection_folders.json` | Connection folders |
| `custom_themes` | `storage/tables/custom_themes.json` | Custom theme CSS |
| `app_settings` | `storage/tables/app_settings.json` | Global app and feature settings |
| `achievement_unlocks` | `storage/tables/achievement_unlocks.json` | Achievement unlock state |
| `chat_presets` | `storage/tables/chat_presets.json` | Per-mode chat settings presets |
| `prompt_overrides` | `storage/tables/prompt_overrides.json` | Built-in prompt override templates |
| `installed_extensions` | `storage/tables/installed_extensions.json` | Cross-device installed extension storage |

When you add a new table, remember that a file-native install needs it registered in `FILE_BACKED_TABLES` in addition to the schema. A table missing from that list is not persisted.

## Legacy SQLite readers

The one-time import needs to read the old database without shipping a full SQLite engine in new installs. Marinara tries two readers in `readLegacyRows()`.

1. The bundled libSQL client is tried first. This is the default reader.
2. If libSQL is unavailable, the built-in `node:sqlite` module is used as a fallback.

The reader that succeeded is recorded in the manifest under `legacyRepair.reader`. You can force the libSQL reader off with the environment variable `MARINARA_DISABLE_LIBSQL_LEGACY_READER=true`. This is useful when debugging the fallback path. New installs do not bundle the older native or WASM SQLite packages.

## Opting back into the legacy SQLite backend

Advanced installs can keep using a live SQLite database instead of file storage. Set the backend to `sqlite` and the driver to `libsql` in your `.env` file:

```text
STORAGE_BACKEND=sqlite
DATABASE_DRIVER=libsql
```

Only the `libsql` driver is supported. Any other `DATABASE_DRIVER` value throws at startup in `packages/server/src/db/connection.ts`, because the older drivers are no longer bundled. When the backend is `sqlite`, Marinara opens the database file and runs the SQLite migration step through `runMigrations()`. It does not use the file-native store.

## Related environment variables

These variables control storage selection and location. The full user-facing reference lives in the configuration guide.

| Variable | Default | Effect |
| --- | --- | --- |
| `STORAGE_BACKEND` | `files` | Set to `sqlite` to use a live SQLite database instead of file storage. |
| `DATABASE_DRIVER` | unset | Only `libsql` is valid, and only when `STORAGE_BACKEND=sqlite`. |
| `FILE_STORAGE_DIR` | `DATA_DIR/storage` | Overrides where the file store writes its JSON files. |
| `DATA_DIR` | server `data` folder | Base directory that holds `storage` and the legacy database file. |
| `MARINARA_DISABLE_LIBSQL_LEGACY_READER` | unset | Set to `true` to skip the libSQL legacy reader and use `node:sqlite`. |

## Follow-up cleanup

The database-shaped internal surface is meant to shrink over time. Planned follow-ups include several steps:

1. Replace direct query calls with a storage facade.
2. Split high-volume domains into append-friendly files such as `messages.ndjson` and `agent-runs.ndjson`.
3. Move object domains into readable directories.
4. Remove the remaining query facade once no route or service depends on it.

## Related guides

- [Architecture Map (Developers)](architecture-map.md)
- [Where Marinara Stores Your Data](../data/where-data-is-stored.md)
