use super::mari;
use crate::state::AppState;
use marinara_core::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn professor_mari_prompt(
    state: State<'_, AppState>,
    request: Value,
    on_event: tauri::ipc::Channel<Value>,
) -> Result<Value, AppError> {
    mari::professor_mari_prompt_with_events(&state, request, Some(on_event)).await
}

#[tauri::command]
pub fn professor_mari_apply_staged_changes(
    state: State<'_, AppState>,
    action: Value,
) -> Result<Value, AppError> {
    mari::professor_mari_apply_staged_changes(&state, action)
}

#[tauri::command]
pub fn professor_mari_resolve_approval(
    state: State<'_, AppState>,
    approval_id: String,
    approved: bool,
) -> Result<Value, AppError> {
    mari::professor_mari_resolve_approval(&state, approval_id, approved)
}
