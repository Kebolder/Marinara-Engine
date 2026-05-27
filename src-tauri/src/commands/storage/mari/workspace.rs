use super::MARI_METADATA_STRING_LIMIT;
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub(crate) struct MariWorkspaceFileRecord {
    pub(crate) path: String,
    pub(crate) content: String,
}

#[derive(Debug, Clone)]
pub(crate) struct MariWorkspaceBinding {
    pub(crate) entity: String,
    pub(crate) id: String,
    pub(crate) field: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct MariWorkspaceSeed {
    pub(crate) files: Vec<MariWorkspaceFileRecord>,
    pub(crate) bindings: BTreeMap<String, MariWorkspaceBinding>,
}

#[derive(Debug, Default)]
struct PathAllocator {
    used: BTreeSet<String>,
}

impl PathAllocator {
    fn child(&mut self, parent: &str, preferred: &str, fallback: &str) -> String {
        let base = sanitize_path_segment(
            first_non_empty(&[Some(preferred), Some(fallback)]).unwrap_or(fallback),
        );
        for index in 1.. {
            let name = if index == 1 {
                base.clone()
            } else {
                format!("{base} ({index})")
            };
            let path = format!("{}/{}", parent.trim_end_matches('/'), name);
            if self.used.insert(path.clone()) {
                return path;
            }
        }
        unreachable!()
    }
}

pub(crate) fn build_mari_workspace_seed(state: &AppState) -> AppResult<MariWorkspaceSeed> {
    let mut seed = MariWorkspaceSeed::default();
    let mut allocator = PathAllocator::default();
    for root in [
        "/workspace/characters",
        "/workspace/character-groups",
        "/workspace/personas",
        "/workspace/persona-groups",
        "/workspace/lorebooks",
        "/workspace/prompts",
    ] {
        allocator.used.insert(root.to_string());
    }
    add_workspace_format_guides(&mut seed);

    let characters = list_storage_or_empty(state, "characters")?;
    add_flat_collection(
        &mut seed,
        &mut allocator,
        "characters",
        "/workspace/characters",
        "Untitled Character",
        &characters,
        &[
            "data.description",
            "data.personality",
            "data.scenario",
            "data.first_mes",
            "data.mes_example",
            "data.creator_notes",
            "data.system_prompt",
            "data.post_history_instructions",
            "data.extensions.backstory",
            "data.extensions.appearance",
        ],
    )?;

    let character_groups = list_storage_or_empty(state, "character-groups")?;
    add_flat_collection(
        &mut seed,
        &mut allocator,
        "character-groups",
        "/workspace/character-groups",
        "Untitled Character Group",
        &character_groups,
        &["description", "notes"],
    )?;

    let personas = list_storage_or_empty(state, "personas")?;
    add_flat_collection(
        &mut seed,
        &mut allocator,
        "personas",
        "/workspace/personas",
        "Untitled Persona",
        &personas,
        &[
            "description",
            "personality",
            "scenario",
            "backstory",
            "appearance",
            "firstMessage",
            "greeting",
            "notes",
        ],
    )?;

    let persona_groups = list_storage_or_empty(state, "persona-groups")?;
    add_flat_collection(
        &mut seed,
        &mut allocator,
        "persona-groups",
        "/workspace/persona-groups",
        "Untitled Persona Group",
        &persona_groups,
        &["description", "notes"],
    )?;

    add_lorebooks_to_workspace(state, &mut seed, &mut allocator)?;
    add_prompts_to_workspace(state, &mut seed, &mut allocator)?;

    add_workspace_index(
        &mut seed,
        &[
            ("characters", characters.len()),
            ("character-groups", character_groups.len()),
            ("personas", personas.len()),
            ("persona-groups", persona_groups.len()),
            (
                "lorebooks",
                list_storage_or_empty(state, "lorebooks")?.len(),
            ),
            ("prompts", list_storage_or_empty(state, "prompts")?.len()),
        ],
    );

    Ok(seed)
}

fn add_workspace_format_guides(seed: &mut MariWorkspaceSeed) {
    add_unbound_file(seed, "/workspace/FORMAT.md", root_format_guide());
    for (path, entity) in [
        ("/workspace/characters/FORMAT.md", "characters"),
        ("/workspace/character-groups/FORMAT.md", "character-groups"),
        ("/workspace/personas/FORMAT.md", "personas"),
        ("/workspace/persona-groups/FORMAT.md", "persona-groups"),
        ("/workspace/lorebooks/FORMAT.md", "lorebooks"),
        ("/workspace/prompts/FORMAT.md", "prompts"),
    ] {
        add_unbound_file(seed, path, format_guide_for_entity(entity));
    }
}

fn root_format_guide() -> String {
    [
        "# Workspace format guide",
        "",
        "Use the nearest `FORMAT.md` before creating or editing files. The root index is only navigation; file layout rules live here and in collection folders.",
        "",
        "## General rules",
        "- Existing records are folders. Edit their existing `.md`, `.txt`, or `metadata.json` files.",
        "- Long prose belongs in the named text files listed by the nearest format guide.",
        "- Structured fields belong in `metadata.json`, which must be valid JSON.",
        "- Do not add storage IDs. Marinara maps friendly paths back to records internally.",
        "- Do not paste base64 images or binary blobs into workspace files.",
        "- Deleting an existing text file clears that field. Deleting `metadata.json` or whole record folders is not an automatic record delete.",
        "",
        "## Creating top-level records",
        "- Create a new folder under `characters/`, `personas/`, `lorebooks/`, `prompts/`, `character-groups/`, or `persona-groups/`.",
        "- Use the exact file names shown in that folder's `FORMAT.md`.",
        "- Include `metadata.json` when you need names, tags, flags, ordering, or other structured fields.",
        "- For character names, set `data.name` in `metadata.json`. For most other records, set `name`.",
    ]
    .join("\n")
}

fn format_guide_for_entity(entity: &str) -> String {
    match entity {
        "characters" => [
            "# Character folder format",
            "",
            "Create or edit one folder per character.",
            "",
            "## Required identity",
            "- `metadata.json`: valid JSON. Set `data.name` to the character name. Optional useful fields: `comment`, `data.tags`, `data.creator`, `data.character_version`.",
            "",
            "## Text files",
            "- `data.description.md`: appearance, role, and durable description.",
            "- `data.personality.md`: personality traits, speaking style, motivations.",
            "- `data.scenario.md`: default situation or setting.",
            "- `data.first_mes.md`: opening message.",
            "- `data.mes_example.md`: example dialogue.",
            "- `data.creator_notes.md`: private notes for the user/creator.",
            "- `data.system_prompt.md`: character-specific system guidance.",
            "- `data.post_history_instructions.md`: instructions applied after chat history.",
            "- `data.extensions.backstory.md`: longer backstory.",
            "- `data.extensions.appearance.md`: detailed visual description.",
        ]
        .join("\n"),
        "character-groups" => [
            "# Character group folder format",
            "",
            "Create or edit one folder per character group.",
            "",
            "## Metadata",
            "- `metadata.json`: valid JSON. Set `name` or `title`. Keep membership/order fields structured here if present.",
            "",
            "## Text files",
            "- `description.md`: what this group is for.",
            "- `notes.md`: private organization notes.",
        ]
        .join("\n"),
        "personas" => [
            "# Persona folder format",
            "",
            "Create or edit one folder per user persona.",
            "",
            "## Metadata",
            "- `metadata.json`: valid JSON. Set `name`. Optional useful fields: `comment`, `tags`, `isActive`.",
            "",
            "## Text files",
            "- `description.md`: concise persona description.",
            "- `personality.md`: traits and behavior.",
            "- `scenario.md`: default context.",
            "- `backstory.md`: history.",
            "- `appearance.md`: visual description.",
            "- `first_message.md`: opening message.",
            "- `greeting.md`: greeting text.",
            "- `notes.md`: private user notes.",
        ]
        .join("\n"),
        "persona-groups" => [
            "# Persona group folder format",
            "",
            "Create or edit one folder per persona group.",
            "",
            "## Metadata",
            "- `metadata.json`: valid JSON. Set `name` or `title`. Keep membership/order fields structured here if present.",
            "",
            "## Text files",
            "- `description.md`: what this group is for.",
            "- `notes.md`: private organization notes.",
        ]
        .join("\n"),
        "lorebooks" => [
            "# Lorebook folder format",
            "",
            "Create or edit one folder per lorebook. Lorebook entries live in that lorebook's `entries/` folder.",
            "",
            "## Metadata",
            "- `metadata.json`: valid JSON. Set `name`. Optional useful fields: `description`, `tags`, `enabled`, `isGlobal`, `scanDepth`, `tokenBudget`, `recursiveScanning`.",
            "",
            "## Text files",
            "- `description.md`: short purpose/summary.",
            "- `content.md`: broad lorebook-level prose if the lorebook uses it.",
            "- `notes.md`: private organization notes.",
            "",
            "## Entries",
            "- Read `entries/FORMAT.md` inside a lorebook before editing or creating entries.",
        ]
        .join("\n"),
        "lorebook-entries" => [
            "# Lorebook entry folder format",
            "",
            "Edit one folder per existing lorebook entry inside this `entries/` folder. Creating brand-new entries from new folders is not applied automatically yet.",
            "",
            "## Metadata",
            "- `metadata.json`: valid JSON. Useful fields include `enabled`, `insertionOrder`, `priority`, `position`, `constant`, `selective`, `secondaryKeys`, `caseSensitive`, `matchWholeWords`.",
            "",
            "## Text files",
            "- `keys.txt`: one activation key per line.",
            "- `content.md`: lore inserted when the entry activates.",
            "- `comment.md`: short label or editor comment.",
            "- `description.md`: optional explanation.",
            "- `notes.md`: private organization notes.",
        ]
        .join("\n"),
        "prompts" => [
            "# Prompt preset folder format",
            "",
            "Create or edit one folder per prompt preset. Sections, groups, and variables live under their matching subfolders.",
            "",
            "## Metadata",
            "- `metadata.json`: valid JSON. Set `name`. Optional useful fields: `description`, `isDefault`, `sectionOrder`, `groupOrder`, `variableOrder`, `parameters`, `variableValues`.",
            "",
            "## Text files",
            "- `description.md`: short purpose/summary.",
            "- `prompt.md`: preset prompt body when used by this record shape.",
            "- `system_prompt.md`: preset-level system prompt.",
            "- `notes.md`: private organization notes.",
            "",
            "## Nested folders",
            "- Read `sections/FORMAT.md`, `groups/FORMAT.md`, or `variables/FORMAT.md` before editing those records.",
        ]
        .join("\n"),
        "prompt-sections" => [
            "# Prompt section folder format",
            "",
            "Edit one folder per existing prompt section inside this `sections/` folder. Creating brand-new sections from new folders is not applied automatically yet.",
            "",
            "## Metadata",
            "- `metadata.json`: valid JSON. Useful fields include `name`, `role`, `type`, `enabled`, `groupId`, `sortOrder`, `markerConfig`.",
            "",
            "## Text files",
            "- `prompt.md`: section prompt text.",
            "- `content.md`: section content if this shape uses content instead of prompt.",
            "- `text.md`: section text if this shape uses text instead of prompt/content.",
            "- `description.md`: editor-facing explanation.",
        ]
        .join("\n"),
        "prompt-groups" => [
            "# Prompt group folder format",
            "",
            "Edit one folder per existing prompt group inside this `groups/` folder. Creating brand-new groups from new folders is not applied automatically yet.",
            "",
            "## Metadata",
            "- `metadata.json`: valid JSON. Useful fields include `name`, `label`, `enabled`, `parentGroupId`, `sortOrder`.",
            "",
            "## Text files",
            "- `description.md`: what this group controls.",
            "- `notes.md`: private organization notes.",
        ]
        .join("\n"),
        "prompt-variables" => [
            "# Prompt variable folder format",
            "",
            "Edit one folder per existing prompt variable inside this `variables/` folder. Creating brand-new variables from new folders is not applied automatically yet.",
            "",
            "## Metadata",
            "- `metadata.json`: valid JSON. Useful fields include `name`, `key`, `label`, `type`, `options`, `defaultValue`, `groupId`, `sortOrder`.",
            "",
            "## Text files",
            "- `value.md`: default or current value.",
            "- `content.md`: content value if this shape uses content.",
            "- `text.md`: text value if this shape uses text.",
            "- `description.md`: editor-facing explanation.",
        ]
        .join("\n"),
        _ => "# Format guide\n\nUse `metadata.json` for structured fields and `.md` files for long text.".to_string(),
    }
}

fn add_flat_collection(
    seed: &mut MariWorkspaceSeed,
    allocator: &mut PathAllocator,
    entity: &str,
    root: &str,
    fallback_label: &str,
    records: &[Value],
    text_fields: &[&str],
) -> AppResult<()> {
    let mut index = Vec::new();
    for record in sorted_records(records) {
        let Some(id) = record_id(record) else {
            continue;
        };
        let label = record_label_for_entity(entity, record, fallback_label);
        let folder = allocator.child(root, &label, fallback_label);
        index.push(format!(
            "- [{}]({})",
            display_label(&label),
            folder.trim_start_matches("/workspace/")
        ));
        add_record_folder(seed, entity, id, &folder, record, text_fields)?;
    }
    add_unbound_file(
        seed,
        format!("{root}/index.md"),
        collection_index_title(entity, index),
    );
    Ok(())
}

fn add_lorebooks_to_workspace(
    state: &AppState,
    seed: &mut MariWorkspaceSeed,
    allocator: &mut PathAllocator,
) -> AppResult<()> {
    let lorebooks = list_storage_or_empty(state, "lorebooks")?;
    let entries = list_storage_or_empty(state, "lorebook-entries")?;
    let mut entries_by_lorebook: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for entry in entries {
        if let Some(lorebook_id) = str_field(&entry, "lorebookId") {
            entries_by_lorebook
                .entry(lorebook_id.to_string())
                .or_default()
                .push(entry);
        }
    }
    let mut index = Vec::new();
    for lorebook in sorted_records(&lorebooks) {
        let Some(id) = record_id(lorebook) else {
            continue;
        };
        let label = record_label_for_entity("lorebooks", lorebook, "Untitled Lorebook");
        let folder = allocator.child("/workspace/lorebooks", &label, "Untitled Lorebook");
        index.push(format!(
            "- [{}]({})",
            display_label(&label),
            folder.trim_start_matches("/workspace/")
        ));
        add_record_folder(
            seed,
            "lorebooks",
            id,
            &folder,
            lorebook,
            &["description", "content", "notes"],
        )?;
        let entry_root = format!("{folder}/entries");
        add_unbound_file(
            seed,
            format!("{entry_root}/FORMAT.md"),
            format_guide_for_entity("lorebook-entries"),
        );
        let mut entry_index = Vec::new();
        for entry in sorted_records(
            entries_by_lorebook
                .get(id)
                .map(Vec::as_slice)
                .unwrap_or(&[]),
        ) {
            let Some(entry_id) = record_id(entry) else {
                continue;
            };
            let entry_label = lorebook_entry_label(entry);
            let entry_folder = allocator.child(&entry_root, &entry_label, "Untitled Entry");
            entry_index.push(format!(
                "- [{}]({})",
                display_label(&entry_label),
                entry_folder.trim_start_matches("/workspace/")
            ));
            add_record_folder(
                seed,
                "lorebook-entries",
                entry_id,
                &entry_folder,
                entry,
                &["content", "comment", "description", "notes"],
            )?;
            if let Some(keys) = keys_text(entry) {
                add_bound_file(
                    seed,
                    format!("{entry_folder}/keys.txt"),
                    keys,
                    "lorebook-entries",
                    entry_id,
                    "keys",
                );
            }
        }
        add_unbound_file(
            seed,
            format!("{entry_root}/index.md"),
            collection_index_title("entries", entry_index),
        );
    }
    add_unbound_file(
        seed,
        "/workspace/lorebooks/index.md",
        collection_index_title("lorebooks", index),
    );
    Ok(())
}

fn add_prompts_to_workspace(
    state: &AppState,
    seed: &mut MariWorkspaceSeed,
    allocator: &mut PathAllocator,
) -> AppResult<()> {
    let prompts = list_storage_or_empty(state, "prompts")?;
    let sections = list_storage_or_empty(state, "prompt-sections")?;
    let groups = list_storage_or_empty(state, "prompt-groups")?;
    let variables = list_storage_or_empty(state, "prompt-variables")?;
    let mut sections_by_preset = group_by_parent(sections, "presetId");
    let mut groups_by_preset = group_by_parent(groups, "presetId");
    let mut variables_by_preset = group_by_parent(variables, "presetId");
    let mut index = Vec::new();
    for prompt in sorted_records(&prompts) {
        let Some(id) = record_id(prompt) else {
            continue;
        };
        let label = record_label_for_entity("prompts", prompt, "Untitled Prompt");
        let folder = allocator.child("/workspace/prompts", &label, "Untitled Prompt");
        index.push(format!(
            "- [{}]({})",
            display_label(&label),
            folder.trim_start_matches("/workspace/")
        ));
        add_record_folder(
            seed,
            "prompts",
            id,
            &folder,
            prompt,
            &["description", "prompt", "systemPrompt", "notes"],
        )?;
        add_nested_prompt_records(
            seed,
            allocator,
            &folder,
            "sections",
            "prompt-sections",
            sections_by_preset.remove(id).unwrap_or_default(),
            &["prompt", "content", "text", "description"],
        )?;
        add_nested_prompt_records(
            seed,
            allocator,
            &folder,
            "groups",
            "prompt-groups",
            groups_by_preset.remove(id).unwrap_or_default(),
            &["description", "notes"],
        )?;
        add_nested_prompt_records(
            seed,
            allocator,
            &folder,
            "variables",
            "prompt-variables",
            variables_by_preset.remove(id).unwrap_or_default(),
            &["value", "content", "text", "description"],
        )?;
    }
    add_unbound_file(
        seed,
        "/workspace/prompts/index.md",
        collection_index_title("prompts", index),
    );
    Ok(())
}

fn add_nested_prompt_records(
    seed: &mut MariWorkspaceSeed,
    allocator: &mut PathAllocator,
    prompt_folder: &str,
    folder_name: &str,
    entity: &str,
    records: Vec<Value>,
    text_fields: &[&str],
) -> AppResult<()> {
    let root = format!("{prompt_folder}/{folder_name}");
    add_unbound_file(
        seed,
        format!("{root}/FORMAT.md"),
        format_guide_for_entity(entity),
    );
    let mut index = Vec::new();
    for record in sorted_records(&records) {
        let Some(id) = record_id(record) else {
            continue;
        };
        let label = record_label_for_entity(
            entity,
            record,
            &format!("Untitled {}", singular_title(folder_name)),
        );
        let folder = allocator.child(
            &root,
            &label,
            &format!("Untitled {}", singular_title(folder_name)),
        );
        index.push(format!(
            "- [{}]({})",
            display_label(&label),
            folder.trim_start_matches("/workspace/")
        ));
        add_record_folder(seed, entity, id, &folder, record, text_fields)?;
    }
    add_unbound_file(
        seed,
        format!("{root}/index.md"),
        collection_index_title(folder_name, index),
    );
    Ok(())
}

fn add_record_folder(
    seed: &mut MariWorkspaceSeed,
    entity: &str,
    id: &str,
    folder: &str,
    record: &Value,
    text_fields: &[&str],
) -> AppResult<()> {
    for field in text_fields {
        if let Some(text) =
            string_field_path(record, field).filter(|value| !value.trim().is_empty())
        {
            add_bound_file(
                seed,
                format!("{folder}/{}.md", field_file_name(field)),
                text.to_string(),
                entity,
                id,
                field,
            );
        }
    }
    let metadata = metadata_without_fields(record, text_fields);
    let content = serde_json::to_string_pretty(&metadata)
        .map_err(|error| AppError::new("mari_workspace_serialize_failed", error.to_string()))?;
    add_bound_file(
        seed,
        format!("{folder}/metadata.json"),
        content,
        entity,
        id,
        "metadata",
    );
    Ok(())
}

fn add_workspace_index(seed: &mut MariWorkspaceSeed, counts: &[(&str, usize)]) {
    let mut lines = vec![
        "# Marinara Workspace".to_string(),
        String::new(),
        "This virtual workspace contains your editable Marinara creative library.".to_string(),
        "Internal storage IDs are hidden from paths; Professor Mari should use the folders below."
            .to_string(),
        "Format requirements live in [FORMAT.md](FORMAT.md) and the nearest folder-level FORMAT.md files."
            .to_string(),
        String::new(),
    ];
    for (name, count) in counts {
        lines.push(format!("- [{name}]({name}/index.md): {count} record(s)"));
    }
    add_unbound_file(seed, "/workspace/index.md", lines.join("\n"));
}

fn add_unbound_file(
    seed: &mut MariWorkspaceSeed,
    path: impl Into<String>,
    content: impl Into<String>,
) {
    seed.files.push(MariWorkspaceFileRecord {
        path: path.into(),
        content: content.into(),
    });
}

fn add_bound_file(
    seed: &mut MariWorkspaceSeed,
    path: String,
    content: String,
    entity: &str,
    id: &str,
    field: &str,
) {
    let binding = MariWorkspaceBinding {
        entity: entity.to_string(),
        id: id.to_string(),
        field: Some(field.to_string()),
    };
    seed.bindings.insert(path.clone(), binding.clone());
    seed.files.push(MariWorkspaceFileRecord { path, content });
}

fn list_storage_or_empty(state: &AppState, entity: &str) -> AppResult<Vec<Value>> {
    state.storage.list(entity).map_err(|error| {
        AppError::new(
            "mari_workspace_load_failed",
            format!("Could not load {entity}: {error}"),
        )
    })
}

fn sorted_records(records: &[Value]) -> Vec<&Value> {
    let mut out = records.iter().collect::<Vec<_>>();
    out.sort_by(|a, b| sort_key(a).cmp(&sort_key(b)));
    out
}

fn sort_key(record: &Value) -> String {
    format!(
        "{:012}|{}",
        numeric_sort_field(record),
        record_label(record, "Untitled").to_ascii_lowercase()
    )
}

fn numeric_sort_field(record: &Value) -> i64 {
    ["sortOrder", "order", "position", "createdAt"]
        .iter()
        .find_map(|field| record.get(*field).and_then(Value::as_i64))
        .unwrap_or(0)
}

fn group_by_parent(records: Vec<Value>, parent_field: &str) -> BTreeMap<String, Vec<Value>> {
    let mut grouped = BTreeMap::new();
    for record in records {
        if let Some(parent_id) = str_field(&record, parent_field) {
            grouped
                .entry(parent_id.to_string())
                .or_insert_with(Vec::new)
                .push(record);
        }
    }
    grouped
}

fn record_id(record: &Value) -> Option<&str> {
    str_field(record, "id")
}

fn record_label(record: &Value, fallback: &str) -> String {
    record_label_for_entity("", record, fallback)
}

pub(crate) fn record_label_for_entity(entity: &str, record: &Value, fallback: &str) -> String {
    let candidates: &[&str] = match entity {
        "characters" => &["data.name"],
        "personas" => &["name", "data.name", "title", "comment"],
        "lorebooks" => &["name", "title"],
        "lorebook-entries" => &["comment", "name"],
        "prompts" => &["name", "title"],
        "prompt-sections" => &["name", "title", "role", "type"],
        "prompt-groups" => &["name", "label", "title"],
        "prompt-variables" => &["name", "key", "label", "title"],
        _ => &["data.name", "name", "title", "label", "comment", "key"],
    };
    first_non_empty(
        &candidates
            .iter()
            .map(|field| string_field_path(record, field))
            .collect::<Vec<_>>(),
    )
    .unwrap_or(fallback)
    .to_string()
}

fn lorebook_entry_label(record: &Value) -> String {
    first_non_empty(&[
        str_field(record, "comment"),
        str_field(record, "name"),
        first_string_array_item(record.get("keys")).as_deref(),
        str_field(record, "content").map(first_line),
    ])
    .unwrap_or("Untitled Entry")
    .to_string()
}

fn first_non_empty<'a>(values: &[Option<&'a str>]) -> Option<&'a str> {
    values
        .iter()
        .flatten()
        .map(|value| value.trim())
        .find(|value| !value.is_empty())
}

fn str_field<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str)
}

fn string_field_path<'a>(value: &'a Value, field_path: &str) -> Option<&'a str> {
    let mut current = value;
    for field in field_path.split('.') {
        current = current.get(field)?;
    }
    current.as_str()
}

pub(crate) fn display_label(label: &str) -> String {
    const LIMIT: usize = 120;
    let clean = label.replace(['\n', '\r'], " ");
    if clean.chars().count() > LIMIT {
        format!("{}…", clean.chars().take(LIMIT).collect::<String>())
    } else {
        clean
    }
}

fn first_line(value: &str) -> &str {
    value.lines().next().unwrap_or(value).trim()
}

fn first_string_array_item(value: Option<&Value>) -> Option<String> {
    string_array_items(value).into_iter().next()
}

fn string_array_items(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn keys_text(record: &Value) -> Option<String> {
    let keys = string_array_items(record.get("keys").or_else(|| record.get("keywords")));
    (!keys.is_empty()).then(|| keys.join("\n"))
}

fn metadata_without_fields(record: &Value, text_fields: &[&str]) -> Value {
    let mut metadata = record.clone();
    remove_field_path(&mut metadata, "id");
    remove_field_path(&mut metadata, "createdAt");
    remove_field_path(&mut metadata, "updatedAt");
    for field in text_fields {
        remove_field_path(&mut metadata, field);
    }
    sanitize_metadata_value(&mut metadata);
    metadata
}

fn remove_field_path(value: &mut Value, field_path: &str) {
    let mut current = value;
    let mut parts = field_path.split('.').peekable();
    while let Some(field) = parts.next() {
        let Some(object) = current.as_object_mut() else {
            return;
        };
        if parts.peek().is_none() {
            object.remove(field);
            return;
        }
        let Some(next) = object.get_mut(field) else {
            return;
        };
        current = next;
    }
}

fn sanitize_metadata_value(value: &mut Value) {
    match value {
        Value::Object(object) => {
            let keys = object.keys().cloned().collect::<Vec<_>>();
            for key in keys {
                if should_remove_metadata_key(&key) {
                    object.remove(&key);
                } else if let Some(child) = object.get_mut(&key) {
                    sanitize_metadata_value(child);
                }
            }
        }
        Value::Array(items) => {
            for item in items.iter_mut().take(64) {
                sanitize_metadata_value(item);
            }
            if items.len() > 64 {
                items.truncate(64);
                items.push(json!("[truncated metadata array]"));
            }
        }
        Value::String(text) => {
            if looks_like_base64_blob(text) {
                *text = "[omitted binary/base64 data]".to_string();
            } else if text.chars().count() > MARI_METADATA_STRING_LIMIT {
                *text = format!(
                    "{}\n[truncated metadata string]",
                    text.chars()
                        .take(MARI_METADATA_STRING_LIMIT)
                        .collect::<String>()
                );
            }
        }
        _ => {}
    }
}

fn should_remove_metadata_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    lower.contains("avatar")
        || lower.contains("image")
        || lower.contains("base64")
        || lower.contains("datauri")
        || lower == "data_url"
        || lower == "dataurl"
}

fn looks_like_base64_blob(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.starts_with("data:image/")
        || (trimmed.len() > 8_000
            && trimmed.chars().all(|ch| {
                ch.is_ascii_alphanumeric() || matches!(ch, '+' | '/' | '=' | '\n' | '\r')
            }))
}

pub(crate) fn field_file_name(field: &str) -> String {
    let mut out = String::new();
    for (index, ch) in field.chars().enumerate() {
        if ch.is_ascii_uppercase() && index > 0 {
            out.push('_');
        }
        out.push(ch.to_ascii_lowercase());
    }
    sanitize_path_segment(&out)
}

fn sanitize_path_segment(value: &str) -> String {
    let mut out = value
        .trim()
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>();
    while out.contains("  ") {
        out = out.replace("  ", " ");
    }
    out = out.trim_matches(['.', ' ']).to_string();
    if out.is_empty() {
        out = "Untitled".to_string();
    }
    if out.chars().count() > 96 {
        out = out.chars().take(96).collect();
    }
    out
}

fn collection_index_title(name: &str, entries: Vec<String>) -> String {
    let mut lines = vec![
        format!("# {}", title_case(name)),
        String::new(),
        "Read [FORMAT.md](FORMAT.md) before changing records in this folder; it also notes what creation is supported."
            .to_string(),
        String::new(),
    ];
    if entries.is_empty() {
        lines.push("No records found.".to_string());
    } else {
        lines.extend(entries);
    }
    lines.join("\n")
}

pub(crate) fn singular_title(name: &str) -> String {
    title_case(name.trim_end_matches('s'))
}

fn title_case(value: &str) -> String {
    value
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
