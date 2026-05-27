#[path = "mari/actions.rs"]
mod actions;
#[path = "mari/agent.rs"]
mod agent;
#[path = "mari/file_changes.rs"]
mod file_changes;
#[path = "mari/prompt.rs"]
mod prompt;
#[path = "mari/shell.rs"]
mod shell;
#[path = "mari/tools.rs"]
mod tools;
#[path = "mari/types.rs"]
mod types;
#[path = "mari/util.rs"]
mod util;
#[path = "mari/workspace.rs"]
mod workspace;

use super::llm::{llm_connection_from_value, resolve_llm_connection_for_request};
use crate::state::AppState;
use agent::{MarinaraLlmProvider, ProfessorMariAgent};
use autoagents::core::agent::memory::SlidingWindowMemory;
use autoagents::core::agent::prebuilt::executor::ReActAgent;
use autoagents::core::agent::task::Task;
use autoagents::core::agent::{AgentBuilder, DirectAgent};
use autoagents::llm::LLMProvider;
use marinara_core::{AppError, AppResult};
use prompt::build_task_prompt;
use serde_json::{json, Value};
use shell::MariShellSession;
use std::sync::Arc;
use tools::build_pi_like_tools;
use types::MariPromptRequest;
use workspace::build_mari_workspace_seed;

pub(crate) const MARI_TEXT_ATTACHMENT_CHAR_LIMIT: usize = 60_000;
pub(crate) const MARI_TOOL_TEXT_LIMIT: usize = 32_000;
pub(crate) const MARI_METADATA_STRING_LIMIT: usize = 4_000;
pub(crate) const MARI_MODEL_OUTPUT_TOKENS: u64 = 0;
pub(crate) const MARI_AGENT_MAX_TURNS: usize = 16;
pub(crate) const MARI_SYSTEM_PROMPT: &str = "You are Professor Mari, a coding-style agent inside a virtual Marinara workspace containing the user's creative library. Reply plainly and helpfully. Use tools to inspect /workspace/index.md and folders like /workspace/characters, /workspace/personas, /workspace/lorebooks, and /workspace/prompts before answering questions about the user's data. The read tool can read files and directories; directory reads return index.md when present, otherwise a listing. Read /workspace/FORMAT.md and the nearest folder-level FORMAT.md before creating or restructuring records. Visible paths use descriptive names; internal storage IDs are hidden and tracked by Marinara. When a modifying tool changes files, Marinara pauses and asks the user to approve or reject before the tool result is returned to you. Do not ask for approval before making edits.";
pub(crate) const MARI_STORAGE_ACTION_ENTITIES: &[&str] = &[
    "characters",
    "character-groups",
    "personas",
    "persona-groups",
    "lorebooks",
    "lorebook-entries",
    "prompts",
    "prompt-sections",
    "prompt-groups",
    "prompt-variables",
];

pub(crate) async fn professor_mari_prompt(state: &AppState, body: Value) -> AppResult<Value> {
    professor_mari_prompt_with_events(state, body, None).await
}

pub(crate) async fn professor_mari_prompt_with_events(
    state: &AppState,
    body: Value,
    trace_channel: Option<tauri::ipc::Channel<Value>>,
) -> AppResult<Value> {
    let input: MariPromptRequest =
        serde_json::from_value(body).map_err(|error| AppError::invalid_input(error.to_string()))?;
    let Some(connection_id) = input
        .connection_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    else {
        return Err(AppError::invalid_input(
            "No connection set for this chat! Click the \"chains\" icon in the input box to select one.",
        ));
    };
    let connection_value = resolve_llm_connection_for_request(
        state,
        &json!({
            "connectionId": connection_id,
        }),
    )?;
    let connection = llm_connection_from_value(&connection_value)?;
    let (content, action, trace) = run_mari_agent(state, connection, &input, trace_channel).await?;

    if content.trim().is_empty() {
        return Err(AppError::new(
            "mari_empty_response",
            "Professor Mari returned an empty response. Try again or select a different connection.",
        ));
    }

    Ok(json!({
        "content": content,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "action": action,
        "trace": trace,
    }))
}

pub(crate) fn professor_mari_apply_staged_changes(
    state: &AppState,
    action: Value,
) -> AppResult<Value> {
    actions::professor_mari_apply_staged_changes(state, action)
}

pub(crate) fn professor_mari_resolve_approval(
    state: &AppState,
    approval_id: String,
    approved: bool,
) -> AppResult<Value> {
    state.resolve_mari_approval(&approval_id, approved)?;
    Ok(json!({
        "resolved": true,
        "approvalId": approval_id,
        "approved": approved,
    }))
}

async fn run_mari_agent(
    state: &AppState,
    connection: marinara_llm::LlmConnection,
    input: &MariPromptRequest,
    trace_channel: Option<tauri::ipc::Channel<Value>>,
) -> AppResult<(String, Value, Vec<Value>)> {
    let workspace_seed = build_mari_workspace_seed(state)?;
    let session = MariShellSession::new(input, workspace_seed, trace_channel).await?;
    let tools = build_pi_like_tools(state.clone(), session.clone());
    let llm: Arc<dyn LLMProvider> = Arc::new(MarinaraLlmProvider::new(connection, session.clone()));
    let agent = ReActAgent::with_max_turns(ProfessorMariAgent { tools }, MARI_AGENT_MAX_TURNS);
    let agent_handle = AgentBuilder::<_, DirectAgent>::new(agent)
        .llm(llm)
        .memory(Box::new(SlidingWindowMemory::new(12)))
        .build()
        .await
        .map_err(|error| AppError::new("mari_agent_failed", error.to_string()))?;

    let result = agent_handle
        .agent
        .run(Task::new(build_task_prompt(input)))
        .await
        .map_err(|error| AppError::new("mari_agent_failed", error.to_string()))?;
    let content = result.trim();
    let content = if content.is_empty() {
        "I couldn't produce a response from the selected model.".to_string()
    } else {
        content.to_string()
    };
    Ok((
        content,
        actions::staged_mari_action_contract(state, &session).await?,
        session.trace_events(),
    ))
}
