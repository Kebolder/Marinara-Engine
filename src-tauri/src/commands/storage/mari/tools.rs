use super::actions;
use super::file_changes;
use super::shell::MariShellSession;
use super::util;
use super::workspace;
use crate::state::AppState;
use autoagents::async_trait;
use autoagents::core::tool::{ToolCallError, ToolRuntime, ToolT};
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fmt;
use std::sync::Arc;

#[derive(Debug, Clone, Copy)]
enum PiToolKind {
    Read,
    Bash,
    Edit,
    Write,
}

impl PiToolKind {
    fn can_mutate(self) -> bool {
        !matches!(self, Self::Read)
    }
}

#[derive(Clone)]
struct PiLikeTool {
    kind: PiToolKind,
    state: AppState,
    session: Arc<MariShellSession>,
}

impl fmt::Debug for PiLikeTool {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PiLikeTool")
            .field("kind", &self.kind)
            .finish()
    }
}

#[async_trait]
impl ToolRuntime for PiLikeTool {
    async fn execute(&self, args: Value) -> Result<Value, ToolCallError> {
        let started_at = chrono::Utc::now().to_rfc3339();
        let tool_name = self.name().to_string();
        let args_for_trace = summarize_tool_args(&tool_name, &args);
        let result = self.execute_with_review(args, &tool_name).await;
        match result {
            Ok(value) => {
                self.session.record_trace(json!({
                    "type": "tool_result",
                    "label": tool_label(&tool_name),
                    "tool": tool_name,
                    "startedAt": started_at,
                    "finishedAt": chrono::Utc::now().to_rfc3339(),
                    "arguments": args_for_trace,
                    "result": summarize_tool_result(&value),
                    "status": "success",
                }));
                Ok(value)
            }
            Err(error) => {
                let message = error.message.clone();
                self.session.record_trace(json!({
                    "type": "tool_result",
                    "label": tool_label(&tool_name),
                    "tool": tool_name,
                    "startedAt": started_at,
                    "finishedAt": chrono::Utc::now().to_rfc3339(),
                    "arguments": args_for_trace,
                    "error": message,
                    "status": "error",
                }));
                Err(tool_runtime_error(error))
            }
        }
    }
}

impl ToolT for PiLikeTool {
    fn name(&self) -> &str {
        match self.kind {
            PiToolKind::Read => "read",
            PiToolKind::Bash => "bash",
            PiToolKind::Edit => "edit",
            PiToolKind::Write => "write",
        }
    }

    fn description(&self) -> &str {
        match self.kind {
            PiToolKind::Read => "Read a file or directory from the virtual workspace. Directory paths return index.md when present, otherwise a listing. Supports optional 1-indexed offset and line limit.",
            PiToolKind::Bash => "Execute bash commands in the isolated virtual workspace. If files change, Mari pauses for user approval before the result is returned.",
            PiToolKind::Edit => "Edit a text file using exact text replacement. oldText must match exactly once. File changes pause for user approval before the result is returned.",
            PiToolKind::Write => "Create or overwrite a text file in the virtual workspace. File changes pause for user approval before the result is returned.",
        }
    }

    fn args_schema(&self) -> Value {
        match self.kind {
            PiToolKind::Read => {
                json!({"type":"object","properties":{"path":{"type":"string"},"offset":{"type":"integer","minimum":1},"limit":{"type":"integer","minimum":1}},"required":["path"]})
            }
            PiToolKind::Bash => {
                json!({"type":"object","properties":{"command":{"type":"string"}},"required":["command"]})
            }
            PiToolKind::Edit => {
                json!({"type":"object","properties":{"path":{"type":"string"},"oldText":{"type":"string"},"newText":{"type":"string"}},"required":["path","oldText","newText"]})
            }
            PiToolKind::Write => {
                json!({"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]})
            }
        }
    }
}

impl PiLikeTool {
    async fn execute_with_review(&self, args: Value, tool_name: &str) -> AppResult<Value> {
        let _guard = self.session.tool_review_guard().await;
        if !self.kind.can_mutate() {
            return self.execute_inner(args).await;
        }

        let before_files = self.session.review_files_snapshot().await?;
        let before_vfs = self.session.vfs_snapshot()?;
        let value = self.execute_inner(args).await?;
        let after_files = self.session.review_files_snapshot().await?;
        if file_changes::diff_file_maps_full(&before_files, &after_files).is_empty() {
            return Ok(value);
        }

        self.review_tool_changes(tool_name, value, before_files, before_vfs)
            .await
    }

    async fn execute_inner(&self, args: Value) -> AppResult<Value> {
        match self.kind {
            PiToolKind::Read => self.tool_read(args).await,
            PiToolKind::Bash => self.tool_bash(args).await,
            PiToolKind::Edit => self.tool_edit(args).await,
            PiToolKind::Write => self.tool_write(args).await,
        }
    }

    async fn review_tool_changes(
        &self,
        tool_name: &str,
        value: Value,
        before_files: BTreeMap<String, Vec<u8>>,
        before_vfs: bashkit::VfsSnapshot,
    ) -> AppResult<Value> {
        let action = actions::staged_mari_action_contract(&self.state, &self.session).await?;
        if storage_action_count(&action) == 0 || unmapped_change_count(&action) > 0 {
            self.session.restore_vfs_snapshot(&before_vfs)?;
            self.session.accept_files_as_baseline(before_files);
            return Err(AppError::invalid_input(
                "Mari changed files that cannot be written to the creative library. Edit character, persona, lorebook, prompt, or group record files only.",
            ));
        }
        if !self.session.has_stream_events() {
            self.session.restore_vfs_snapshot(&before_vfs)?;
            self.session.accept_files_as_baseline(before_files);
            return Err(AppError::invalid_input(
                "Professor Mari needs the embedded approval UI before changing creative-library files. Remote prompt calls are read-only for now.",
            ));
        }
        let approval_id = self.session.next_approval_id(tool_name);
        let requested_at = chrono::Utc::now().to_rfc3339();
        let receiver = self.state.register_mari_approval(&approval_id)?;
        let approval = json!({
            "id": approval_id,
            "tool": tool_name,
            "label": tool_label(tool_name),
            "requestedAt": requested_at,
            "action": action,
            "result": summarize_tool_result(&value),
        });

        self.session.record_trace(json!({
            "type": "approval_request",
            "label": "Review changes",
            "tool": tool_name,
            "status": "waiting",
            "summary": approval_summary(approval.get("action").unwrap_or(&Value::Null)),
            "approvalId": approval_id,
        }));

        if let Err(error) = self
            .session
            .send_stream_event(json!({ "type": "approval_request", "approval": approval }))
        {
            self.state.cancel_mari_approval(&approval_id);
            self.session.restore_vfs_snapshot(&before_vfs)?;
            self.session.accept_files_as_baseline(before_files);
            return Err(error);
        }

        let approved = match receiver.await {
            Ok(approved) => approved,
            Err(_) => {
                self.session.restore_vfs_snapshot(&before_vfs)?;
                self.session.accept_files_as_baseline(before_files);
                return Err(AppError::new(
                    "mari_approval_cancelled",
                    "Professor Mari approval was cancelled before a decision was received",
                ));
            }
        };

        if !approved {
            self.session.restore_vfs_snapshot(&before_vfs)?;
            self.session.accept_files_as_baseline(before_files);
            let outcome = approval_outcome(&approval_id, false, &action, None, None);
            self.session.record_trace(json!({
                "type": "approval_resolved",
                "label": "Changes rejected",
                "tool": tool_name,
                "status": "rejected",
                "summary": "The workspace was rolled back before Mari continued.",
                "approvalId": approval_id,
            }));
            let _ = self.session.send_stream_event(json!({
                "type": "approval_resolved",
                "approvalId": approval_id,
                "approved": false,
                "outcome": outcome,
            }));
            return Ok(with_approval_outcome(value, outcome));
        }

        let apply_result = match apply_storage_actions_if_needed(&self.state, &action) {
            Ok(result) => result,
            Err(error) => {
                let message = error.message.clone();
                let _ = self.session.restore_vfs_snapshot(&before_vfs);
                self.session.accept_files_as_baseline(before_files);
                let _ = self.session.send_stream_event(json!({
                    "type": "approval_resolved",
                    "approvalId": approval_id,
                    "approved": true,
                    "error": message,
                }));
                return Err(error);
            }
        };
        absorb_storage_action_bindings(&self.session, &action, &apply_result);
        self.session.accept_current_as_baseline().await?;
        let outcome = approval_outcome(&approval_id, true, &action, Some(&apply_result), None);
        self.session.record_trace(json!({
            "type": "approval_resolved",
            "label": "Changes approved",
            "tool": tool_name,
            "status": "approved",
            "summary": approval_summary(&action),
            "approvalId": approval_id,
        }));
        let _ = self.session.send_stream_event(json!({
            "type": "approval_resolved",
            "approvalId": approval_id,
            "approved": true,
            "outcome": outcome,
            "applied": summarize_apply_result(&apply_result),
        }));
        Ok(with_approval_outcome(value, outcome))
    }

    async fn tool_read(&self, args: Value) -> AppResult<Value> {
        let path = required_str(&args, "path")?;
        let offset = args
            .get("offset")
            .and_then(Value::as_u64)
            .unwrap_or(1)
            .max(1) as usize;
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .map(|v| v.max(1) as usize);
        self.session.read_for_tool(path, offset, limit).await
    }

    async fn tool_bash(&self, args: Value) -> AppResult<Value> {
        self.session
            .exec_bash(required_str(&args, "command")?)
            .await
    }

    async fn tool_edit(&self, args: Value) -> AppResult<Value> {
        self.session
            .edit_text(
                required_str(&args, "path")?,
                required_str(&args, "oldText")?,
                required_str(&args, "newText")?,
            )
            .await
    }

    async fn tool_write(&self, args: Value) -> AppResult<Value> {
        self.session
            .write_text(
                required_str(&args, "path")?,
                required_str(&args, "content")?,
            )
            .await
    }
}

fn tool_label(name: &str) -> String {
    match name {
        "read" => "Read file",
        "bash" => "Run bash",
        "edit" => "Edit file",
        "write" => "Write file",
        _ => "Use tool",
    }
    .to_string()
}

fn summarize_tool_args(tool: &str, args: &Value) -> Value {
    match tool {
        "read" => json!({
            "path": args.get("path").cloned().unwrap_or(Value::Null),
            "offset": args.get("offset").cloned().unwrap_or(Value::Null),
            "limit": args.get("limit").cloned().unwrap_or(Value::Null),
        }),
        "bash" => json!({
            "command": args.get("command").and_then(Value::as_str).map(util::truncate_tool_text).unwrap_or_default(),
        }),
        "edit" => json!({
            "path": args.get("path").cloned().unwrap_or(Value::Null),
            "oldText": args.get("oldText").and_then(Value::as_str).map(util::truncate_tool_text).unwrap_or_default(),
            "newText": args.get("newText").and_then(Value::as_str).map(util::truncate_tool_text).unwrap_or_default(),
        }),
        "write" => json!({
            "path": args.get("path").cloned().unwrap_or(Value::Null),
            "content": args.get("content").and_then(Value::as_str).map(util::truncate_tool_text).unwrap_or_default(),
        }),
        _ => args.clone(),
    }
}

fn summarize_tool_result(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| {
                    let next = match value {
                        Value::String(text) => Value::String(util::truncate_tool_text(text)),
                        _ => value.clone(),
                    };
                    (key.clone(), next)
                })
                .collect(),
        ),
        Value::String(text) => Value::String(util::truncate_tool_text(text)),
        _ => value.clone(),
    }
}

fn apply_storage_actions_if_needed(state: &AppState, action: &Value) -> AppResult<Value> {
    if storage_action_count(action) == 0 {
        return Err(AppError::invalid_input(
            "No creative-library storage changes were available to apply",
        ));
    }
    actions::professor_mari_apply_staged_changes(state, action.clone())
}

fn with_approval_outcome(mut value: Value, outcome: Value) -> Value {
    if let Value::Object(object) = &mut value {
        object.insert("approval".to_string(), outcome);
        object.insert("pendingChanges".to_string(), Value::Array(Vec::new()));
        return value;
    }
    json!({ "result": value, "approval": outcome })
}

fn approval_outcome(
    approval_id: &str,
    approved: bool,
    action: &Value,
    apply_result: Option<&Value>,
    error: Option<&str>,
) -> Value {
    json!({
        "id": approval_id,
        "status": if approved { "approved" } else { "rejected" },
        "approved": approved,
        "changeCount": change_count(action),
        "storageActionCount": storage_action_count(action),
        "unmappedChangeCount": unmapped_change_count(action),
        "summary": approval_summary(action),
        "applied": apply_result.map(summarize_apply_result).unwrap_or(Value::Null),
        "error": error,
    })
}

fn summarize_apply_result(value: &Value) -> Value {
    json!({
        "applied": value.get("applied").and_then(Value::as_u64).unwrap_or_default(),
        "appliedAt": value.get("appliedAt").cloned().unwrap_or(Value::Null),
        "results": value
            .get("results")
            .and_then(Value::as_array)
            .map(|results| {
                results
                    .iter()
                    .map(|result| json!({
                        "type": result.get("type").cloned().unwrap_or(Value::Null),
                        "entity": result.get("entity").cloned().unwrap_or(Value::Null),
                        "id": result
                            .get("id")
                            .cloned()
                            .or_else(|| result.get("record").and_then(|record| record.get("id")).cloned())
                            .unwrap_or(Value::Null),
                    }))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
    })
}

fn approval_summary(action: &Value) -> String {
    let changes = change_count(action);
    let storage_actions = storage_action_count(action);
    let unmapped = unmapped_change_count(action);
    match (storage_actions, unmapped) {
        (0, 0) => format!("{changes} workspace file change{} ready for review before Mari's next step.", plural(changes)),
        (0, _) => format!(
            "{changes} workspace file change{} need review; {unmapped} cannot be applied to storage automatically.",
            plural(changes)
        ),
        (_, 0) => format!(
            "{storage_actions} library update{} from {changes} file change{}.",
            plural(storage_actions),
            plural(changes)
        ),
        _ => format!(
            "{storage_actions} library update{} plus {unmapped} workspace-only change{}.",
            plural(storage_actions),
            plural(unmapped)
        ),
    }
}

fn change_count(action: &Value) -> usize {
    action
        .get("changes")
        .and_then(Value::as_array)
        .map_or(0, Vec::len)
}

fn storage_action_count(action: &Value) -> usize {
    action
        .get("storageActions")
        .and_then(Value::as_array)
        .map_or(0, Vec::len)
}

fn unmapped_change_count(action: &Value) -> usize {
    action
        .get("unmappedChanges")
        .and_then(Value::as_array)
        .map_or(0, Vec::len)
}

fn plural(count: usize) -> &'static str {
    if count == 1 {
        ""
    } else {
        "s"
    }
}

fn absorb_storage_action_bindings(
    session: &MariShellSession,
    action: &Value,
    apply_result: &Value,
) {
    let Some(storage_actions) = action.get("storageActions").and_then(Value::as_array) else {
        return;
    };
    let results = apply_result
        .get("results")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for (index, storage_action) in storage_actions.iter().enumerate() {
        let Some(entity) = storage_action.get("entity").and_then(Value::as_str) else {
            continue;
        };
        let id = storage_action
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| {
                results
                    .get(index)
                    .and_then(|result| result.get("record"))
                    .and_then(|record| record.get("id"))
                    .and_then(Value::as_str)
            });
        let Some(id) = id else {
            continue;
        };
        let Some(paths) = storage_action.get("paths").and_then(Value::as_array) else {
            continue;
        };
        for path in paths.iter().filter_map(Value::as_str) {
            if let Some(field) = field_for_workspace_path(entity, path) {
                session.bind_workspace_file(
                    util::resolve_virtual_path(path),
                    entity.to_string(),
                    id.to_string(),
                    field.to_string(),
                );
            }
        }
    }
}

fn field_for_workspace_path(entity: &str, path: &str) -> Option<&'static str> {
    let file_name = path.rsplit('/').next()?;
    if file_name == "metadata.json" {
        return Some("metadata");
    }
    if file_name == "keys.txt" {
        return Some("keys");
    }
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

pub(crate) fn build_pi_like_tools(
    state: AppState,
    session: Arc<MariShellSession>,
) -> Vec<Arc<dyn ToolT>> {
    [
        PiToolKind::Read,
        PiToolKind::Bash,
        PiToolKind::Edit,
        PiToolKind::Write,
    ]
    .into_iter()
    .map(|kind| {
        Arc::new(PiLikeTool {
            kind,
            state: state.clone(),
            session: session.clone(),
        }) as Arc<dyn ToolT>
    })
    .collect()
}

fn required_str<'a>(value: &'a Value, key: &str) -> AppResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input(format!("missing required string field `{key}`")))
}

fn tool_runtime_error(error: AppError) -> ToolCallError {
    ToolCallError::RuntimeError(Box::new(std::io::Error::other(error.to_string())))
}
