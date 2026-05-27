use super::file_changes::{self, MariFileChange};
use super::shell::MariShellSession;
use super::util;
use super::workspace::{self, MariWorkspaceBinding};
use super::MARI_STORAGE_ACTION_ENTITIES;
use crate::state::AppState;
use crate::storage_commands::shared;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn professor_mari_apply_staged_changes(
    state: &AppState,
    action: Value,
) -> AppResult<Value> {
    let storage_actions = extract_storage_actions(&action)?;
    let prepared = storage_actions
        .iter()
        .map(prepare_mari_storage_action)
        .collect::<AppResult<Vec<_>>>()?;
    if prepared.is_empty() {
        return Err(AppError::invalid_input(
            "No applicable Professor Mari storage changes were provided",
        ));
    }

    let mut results = Vec::with_capacity(prepared.len());
    for action in prepared {
        match action {
            PreparedMariStorageAction::Create { entity, draft } => {
                let record = state
                    .storage
                    .create(&entity, shared::with_entity_defaults(&entity, draft)?)?;
                results
                    .push(json!({ "type": "create_record", "entity": entity, "record": record }));
            }
            PreparedMariStorageAction::Edit { entity, id, patch } => {
                let record = state.storage.patch(
                    &entity,
                    &id,
                    shared::normalize_update_patch(&entity, patch)?,
                )?;
                results.push(
                    json!({ "type": "edit_record", "entity": entity, "id": id, "record": record }),
                );
            }
        }
    }

    Ok(json!({
        "applied": results.len(),
        "appliedAt": chrono::Utc::now().to_rfc3339(),
        "results": results,
    }))
}

#[derive(Debug)]
enum PreparedMariStorageAction {
    Create {
        entity: String,
        draft: Value,
    },
    Edit {
        entity: String,
        id: String,
        patch: Value,
    },
}

#[derive(Debug, Clone)]
struct MariExistingRecordDraft {
    before: Value,
    after: Value,
    paths: BTreeSet<String>,
}

#[derive(Debug, Clone)]
struct MariNewRecordDraft {
    entity: String,
    label: String,
    draft: Value,
    paths: BTreeSet<String>,
}

#[derive(Debug, Clone)]
struct MariNewRecordTarget {
    entity: String,
    folder_path: String,
    label: String,
    field: String,
}

fn extract_storage_actions(action: &Value) -> AppResult<Vec<Value>> {
    if let Some(actions) = action.get("storageActions").and_then(Value::as_array) {
        return Ok(actions.to_vec());
    }
    if matches!(
        action.get("type").and_then(Value::as_str),
        Some("create_record" | "edit_record")
    ) {
        return Ok(vec![action.clone()]);
    }
    Err(AppError::invalid_input(
        "Professor Mari action did not include storageActions",
    ))
}

fn prepare_mari_storage_action(action: &Value) -> AppResult<PreparedMariStorageAction> {
    let object = action.as_object().ok_or_else(|| {
        AppError::invalid_input("Professor Mari storage action must be an object")
    })?;
    let action_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid_input("Professor Mari storage action is missing type"))?;
    let entity = object
        .get("entity")
        .and_then(Value::as_str)
        .filter(|entity| MARI_STORAGE_ACTION_ENTITIES.contains(entity))
        .ok_or_else(|| {
            AppError::invalid_input("Professor Mari storage action has an invalid entity")
        })?
        .to_string();

    match action_type {
        "create_record" => {
            let draft = object
                .get("draft")
                .filter(|value| value.is_object())
                .ok_or_else(|| AppError::invalid_input("create_record action is missing draft"))?
                .clone();
            Ok(PreparedMariStorageAction::Create { entity, draft })
        }
        "edit_record" => {
            let id = object
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| AppError::invalid_input("edit_record action is missing id"))?
                .to_string();
            let patch = object
                .get("patch")
                .filter(|value| value.is_object())
                .ok_or_else(|| AppError::invalid_input("edit_record action is missing patch"))?
                .clone();
            Ok(PreparedMariStorageAction::Edit { entity, id, patch })
        }
        _ => Err(AppError::invalid_input(format!(
            "Unsupported Professor Mari storage action type: {action_type}"
        ))),
    }
}

fn staged_storage_actions(
    state: &AppState,
    session: &MariShellSession,
    changes: &[MariFileChange],
) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let manifest = session.manifest_snapshot();
    let mut existing_drafts: BTreeMap<(String, String), MariExistingRecordDraft> = BTreeMap::new();
    let mut new_drafts: BTreeMap<String, MariNewRecordDraft> = BTreeMap::new();
    let mut issues = Vec::new();

    for change in changes {
        if let Some(binding) = manifest.get(&change.path) {
            match apply_bound_change(state, &mut existing_drafts, binding, change)? {
                Ok(()) => {}
                Err(reason) => issues.push(change_issue(change, Some(binding), reason)),
            }
            continue;
        }

        if let Some(target) = new_record_target(&change.path) {
            if let Some(folder_binding) = existing_folder_binding(&manifest, &target.folder_path) {
                let inferred_binding = MariWorkspaceBinding {
                    entity: folder_binding.entity.clone(),
                    id: folder_binding.id.clone(),
                    field: Some(target.field.clone()),
                };
                match apply_bound_change(state, &mut existing_drafts, &inferred_binding, change)? {
                    Ok(()) => {}
                    Err(reason) => {
                        issues.push(change_issue(change, Some(&inferred_binding), reason))
                    }
                }
                continue;
            }

            match apply_new_record_change(&mut new_drafts, target, change) {
                Ok(()) => {}
                Err(reason) => issues.push(change_issue(change, None, reason)),
            }
            continue;
        }

        issues.push(change_issue(
            change,
            None,
            "This workspace file is not mapped to a Marinara storage field.".to_string(),
        ));
    }

    let mut actions = Vec::new();
    for ((entity, id), draft) in existing_drafts {
        let patch = record_patch(&draft.before, &draft.after);
        if patch.is_empty() {
            continue;
        }
        let patch = shared::normalize_update_patch(&entity, Value::Object(patch))?;
        let label = workspace::record_label_for_entity(&entity, &draft.after, "Record");
        let action_label = format!(
            "Edit {}: {}",
            workspace::singular_title(&entity),
            workspace::display_label(&label)
        );
        actions.push(json!({
            "type": "edit_record",
            "entity": entity,
            "id": id,
            "patch": patch,
            "label": action_label,
            "paths": draft.paths.into_iter().collect::<Vec<_>>(),
        }));
    }

    for (_, draft) in new_drafts {
        if draft.paths.is_empty() {
            continue;
        }
        let entity = draft.entity;
        let normalized_draft = shared::with_entity_defaults(&entity, draft.draft)?;
        let label = workspace::record_label_for_entity(&entity, &normalized_draft, &draft.label);
        let action_label = format!(
            "Create {}: {}",
            workspace::singular_title(&entity),
            workspace::display_label(&label)
        );
        actions.push(json!({
            "type": "create_record",
            "entity": entity,
            "draft": normalized_draft,
            "label": action_label,
            "paths": draft.paths.into_iter().collect::<Vec<_>>(),
        }));
    }

    Ok((actions, issues))
}

fn apply_bound_change(
    state: &AppState,
    drafts: &mut BTreeMap<(String, String), MariExistingRecordDraft>,
    binding: &MariWorkspaceBinding,
    change: &MariFileChange,
) -> AppResult<Result<(), String>> {
    let Some(field) = binding.field.as_deref() else {
        return Ok(Err(
            "This workspace path is not bound to an editable field.".to_string(),
        ));
    };
    let draft = existing_record_draft(state, drafts, &binding.entity, &binding.id)?;
    let result = apply_field_change(&mut draft.after, &binding.entity, field, change);
    if result.is_ok() {
        draft.paths.insert(change.path.clone());
    }
    Ok(result)
}

fn existing_record_draft<'a>(
    state: &AppState,
    drafts: &'a mut BTreeMap<(String, String), MariExistingRecordDraft>,
    entity: &str,
    id: &str,
) -> AppResult<&'a mut MariExistingRecordDraft> {
    let key = (entity.to_string(), id.to_string());
    if !drafts.contains_key(&key) {
        let record = state
            .storage
            .get(entity, id)?
            .ok_or_else(|| AppError::not_found(format!("{entity}/{id} was not found")))?;
        drafts.insert(
            key.clone(),
            MariExistingRecordDraft {
                before: record.clone(),
                after: record,
                paths: BTreeSet::new(),
            },
        );
    }
    Ok(drafts.get_mut(&key).expect("draft inserted above"))
}

fn apply_new_record_change(
    drafts: &mut BTreeMap<String, MariNewRecordDraft>,
    target: MariNewRecordTarget,
    change: &MariFileChange,
) -> Result<(), String> {
    if change.op == "delete" {
        return Err(
            "Deleting a newly created unmapped file cannot be applied to storage.".to_string(),
        );
    }
    let draft = drafts
        .entry(target.folder_path.clone())
        .or_insert_with(|| MariNewRecordDraft {
            entity: target.entity.clone(),
            label: target.label.clone(),
            draft: initial_draft_for_entity(&target.entity, &target.label),
            paths: BTreeSet::new(),
        });
    apply_field_change(&mut draft.draft, &draft.entity, &target.field, change)?;
    draft.paths.insert(change.path.clone());
    Ok(())
}

fn apply_field_change(
    record: &mut Value,
    _entity: &str,
    field: &str,
    change: &MariFileChange,
) -> Result<(), String> {
    if field == "metadata" {
        let text = change_after_text(change)
            .ok_or_else(|| "Deleting metadata.json cannot be applied to storage.".to_string())?;
        let metadata: Value = serde_json::from_str(&text)
            .map_err(|error| format!("metadata.json is not valid JSON: {error}"))?;
        merge_metadata_into_record(record, metadata)?;
        return Ok(());
    }

    let text = change_after_text(change).unwrap_or_default();
    let value = if field == "keys" {
        Value::Array(
            text.lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(|line| Value::String(line.to_string()))
                .collect(),
        )
    } else {
        Value::String(text)
    };
    set_field_path_value(record, field, value)
}

fn merge_metadata_into_record(record: &mut Value, mut metadata: Value) -> Result<(), String> {
    let object = metadata
        .as_object_mut()
        .ok_or_else(|| "metadata.json must contain a JSON object.".to_string())?;
    object.remove("id");
    object.remove("createdAt");
    object.remove("updatedAt");
    merge_json_value(record, metadata);
    Ok(())
}

fn merge_json_value(target: &mut Value, source: Value) {
    match source {
        Value::Object(source_object) => {
            if let Some(target_object) = target.as_object_mut() {
                for (key, value) in source_object {
                    if let Some(existing) = target_object.get_mut(&key) {
                        merge_json_value(existing, value);
                    } else {
                        target_object.insert(key, value);
                    }
                }
            } else {
                *target = Value::Object(source_object);
            }
        }
        other => *target = other,
    }
}

fn set_field_path_value(record: &mut Value, field_path: &str, value: Value) -> Result<(), String> {
    let parts = field_path
        .split('.')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let Some((last, parents)) = parts.split_last() else {
        return Err("Field path was empty.".to_string());
    };
    let mut current = record;
    for part in parents {
        if !current.is_object() {
            *current = Value::Object(Map::new());
        }
        let object = current
            .as_object_mut()
            .ok_or_else(|| format!("Could not write nested field {field_path}"))?;
        current = object
            .entry((*part).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
    }
    if !current.is_object() {
        *current = Value::Object(Map::new());
    }
    let object = current
        .as_object_mut()
        .ok_or_else(|| format!("Could not write field {field_path}"))?;
    object.insert((*last).to_string(), value);
    Ok(())
}

fn record_patch(before: &Value, after: &Value) -> Map<String, Value> {
    let mut patch = Map::new();
    let Some(after_object) = after.as_object() else {
        return patch;
    };
    let before_object = before.as_object();
    for (key, value) in after_object {
        if matches!(key.as_str(), "id" | "createdAt" | "updatedAt") {
            continue;
        }
        if before_object.and_then(|object| object.get(key)) != Some(value) {
            patch.insert(key.clone(), value.clone());
        }
    }
    patch
}

fn change_after_text(change: &MariFileChange) -> Option<String> {
    change
        .after
        .as_ref()
        .map(|bytes| String::from_utf8_lossy(bytes).to_string())
}

fn new_record_target(path: &str) -> Option<MariNewRecordTarget> {
    let normalized = util::normalize_virtual_path(path);
    let parts = normalized.trim_matches('/').split('/').collect::<Vec<_>>();
    if parts.len() != 4 || parts.first().copied() != Some("workspace") {
        return None;
    }
    let entity = parts[1];
    if !matches!(
        entity,
        "characters" | "character-groups" | "personas" | "persona-groups" | "lorebooks" | "prompts"
    ) {
        return None;
    }
    let file_name = parts[3];
    let field = if file_name == "metadata.json" {
        "metadata".to_string()
    } else {
        text_field_for_workspace_file(entity, file_name)?.to_string()
    };
    Some(MariNewRecordTarget {
        entity: entity.to_string(),
        folder_path: format!("/workspace/{entity}/{}", parts[2]),
        label: parts[2].to_string(),
        field,
    })
}

fn existing_folder_binding<'a>(
    manifest: &'a BTreeMap<String, MariWorkspaceBinding>,
    folder_path: &str,
) -> Option<&'a MariWorkspaceBinding> {
    let prefix = format!("{}/", folder_path.trim_end_matches('/'));
    manifest
        .iter()
        .find(|(path, binding)| {
            path.starts_with(&prefix) && binding.field.as_deref() == Some("metadata")
        })
        .map(|(_, binding)| binding)
        .or_else(|| {
            manifest
                .iter()
                .find(|(path, _)| path.starts_with(&prefix))
                .map(|(_, binding)| binding)
        })
}

fn text_field_for_workspace_file(entity: &str, file_name: &str) -> Option<&'static str> {
    let stem = file_name.strip_suffix(".md")?;
    workspace_text_fields_for_entity(entity)
        .iter()
        .copied()
        .find(|field| workspace::field_file_name(field) == stem)
}

fn workspace_text_fields_for_entity(entity: &str) -> &'static [&'static str] {
    match entity {
        "characters" => &[
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
        "character-groups" => &["description", "notes"],
        "personas" => &[
            "description",
            "personality",
            "scenario",
            "backstory",
            "appearance",
            "firstMessage",
            "greeting",
            "notes",
        ],
        "persona-groups" => &["description", "notes"],
        "lorebooks" => &["description", "content", "notes"],
        "lorebook-entries" => &["content", "comment", "description", "notes", "keys"],
        "prompts" => &["description", "prompt", "systemPrompt", "notes"],
        "prompt-sections" => &["prompt", "content", "text", "description"],
        "prompt-groups" => &["description", "notes"],
        "prompt-variables" => &["value", "content", "text", "description"],
        _ => &[],
    }
}

fn initial_draft_for_entity(entity: &str, label: &str) -> Value {
    match entity {
        "characters" => json!({
            "name": label,
            "data": {
                "name": label,
                "description": "",
                "personality": "",
                "scenario": "",
                "first_mes": "",
                "mes_example": "",
                "creator_notes": "",
                "system_prompt": "",
                "post_history_instructions": "",
                "tags": [],
                "creator": "",
                "character_version": "1.0",
                "alternate_greetings": [],
                "extensions": { "altDescriptions": [] },
                "character_book": null
            },
            "comment": ""
        }),
        "personas" => json!({
            "name": label,
            "description": "",
            "comment": "",
            "personality": "",
            "scenario": "",
            "backstory": "",
            "appearance": ""
        }),
        "lorebooks" | "prompts" | "character-groups" | "persona-groups" => {
            json!({ "name": label })
        }
        _ => json!({ "name": label }),
    }
}

fn change_issue(
    change: &MariFileChange,
    binding: Option<&MariWorkspaceBinding>,
    reason: String,
) -> Value {
    let mut value = match file_changes::file_change_summary(change) {
        Value::Object(object) => object,
        _ => Map::new(),
    };
    value.insert("reason".to_string(), Value::String(reason));
    if let Some(binding) = binding {
        value.insert(
            "binding".to_string(),
            json!({
                "entity": &binding.entity,
                "id": &binding.id,
                "field": &binding.field,
            }),
        );
    }
    Value::Object(value)
}

fn file_change_summary_with_binding(
    change: &MariFileChange,
    binding: Option<&MariWorkspaceBinding>,
) -> Value {
    let mut value = match file_changes::file_change_summary(change) {
        Value::Object(object) => object,
        _ => Map::new(),
    };
    if let Some(binding) = binding {
        value.insert(
            "binding".to_string(),
            json!({
                "entity": &binding.entity,
                "id": &binding.id,
                "field": &binding.field,
            }),
        );
    }
    Value::Object(value)
}

pub(crate) async fn staged_mari_action_contract(
    state: &AppState,
    session: &MariShellSession,
) -> AppResult<Value> {
    let changes = session.pending_file_changes().await?;
    let (storage_actions, unmapped_changes) = staged_storage_actions(state, session, &changes)?;
    let manifest = session.manifest_snapshot();
    let change_summaries = changes
        .iter()
        .map(|change| file_change_summary_with_binding(change, manifest.get(&change.path)))
        .collect::<Vec<_>>();
    Ok(json!({
        "type": if changes.is_empty() { "none" } else { "staged_file_changes" },
        "capability": "bashkit_virtual_workspace",
        "changes": change_summaries,
        "storageActions": storage_actions,
        "unmappedChanges": unmapped_changes,
        "workspaceManifest": session.manifest_summary(),
        "approvalRequired": !storage_actions.is_empty() && unmapped_changes.is_empty(),
    }))
}
