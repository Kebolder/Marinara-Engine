use super::llm::{llm_connection_from_value, resolve_llm_connection_for_request};
use crate::state::AppState;
use autoagents::async_trait;
use autoagents::core::agent::memory::SlidingWindowMemory;
use autoagents::core::agent::prebuilt::executor::ReActAgent;
use autoagents::core::agent::task::Task;
use autoagents::core::agent::{AgentBuilder, AgentDeriveT, DirectAgent};
use autoagents::core::tool::{shared_tools_to_boxes, ToolCallError, ToolRuntime, ToolT};
use autoagents::llm::chat::{
    ChatMessage, ChatProvider, ChatResponse, MessageType, SamplingOverrides,
    StructuredOutputFormat, Tool,
};
use autoagents::llm::completion::{CompletionProvider, CompletionRequest, CompletionResponse};
use autoagents::llm::embedding::EmbeddingProvider;
use autoagents::llm::error::LLMError;
use autoagents::llm::models::{ModelListRequest, ModelListResponse, ModelsProvider};
use autoagents::llm::LLMProvider;
use autoagents::llm::{FunctionCall, ToolCall};
use autoagents::prelude::AgentHooks;
use bashkit::{
    async_trait as bashkit_async_trait, Bash, DirEntry, FileSystem, FileSystemExt, FileType,
    InMemoryFs, Metadata,
};
use marinara_core::{AppError, AppResult};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::SystemTime;
use tokio::sync::Mutex;

const MARI_TEXT_ATTACHMENT_CHAR_LIMIT: usize = 60_000;
const MARI_TOOL_TEXT_LIMIT: usize = 32_000;
const MARI_METADATA_STRING_LIMIT: usize = 4_000;
const MARI_SYSTEM_PROMPT: &str = "You are Professor Mari, a coding-style agent inside a virtual Marinara workspace containing the user's creative library. Reply plainly and helpfully. Use tools to inspect /workspace/index.md and folders like /workspace/characters, /workspace/personas, /workspace/lorebooks, and /workspace/prompts before answering questions about the user's data. Visible paths use descriptive names; internal storage IDs are hidden and tracked by Marinara. File changes are staged for user review after your commands; do not ask for approval before making staged edits.";

#[derive(Clone, AgentHooks)]
struct ProfessorMariAgent {
    tools: Vec<Arc<dyn ToolT>>,
}

impl fmt::Debug for ProfessorMariAgent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ProfessorMariAgent")
            .field("tool_count", &self.tools.len())
            .finish()
    }
}

impl AgentDeriveT for ProfessorMariAgent {
    type Output = String;

    fn description(&self) -> &str {
        MARI_SYSTEM_PROMPT
    }

    fn output_schema(&self) -> Option<Value> {
        None
    }

    fn name(&self) -> &str {
        "professor_mari"
    }

    fn tools(&self) -> Vec<Box<dyn ToolT>> {
        shared_tools_to_boxes(&self.tools)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MariPromptRequest {
    user_message: String,
    #[serde(default)]
    messages: Vec<MariPromptMessage>,
    #[serde(default)]
    connection_id: Option<String>,
    #[serde(default)]
    persona: Option<MariPersonaContext>,
    #[serde(default)]
    attachments: Vec<MariAttachment>,
    #[serde(default)]
    workspace_files: Vec<MariWorkspaceFile>,
}

#[derive(Debug, Deserialize)]
struct MariPromptMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MariPersonaContext {
    name: Option<String>,
    comment: Option<String>,
    description: Option<String>,
    personality: Option<String>,
    scenario: Option<String>,
    backstory: Option<String>,
    appearance: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MariAttachment {
    name: String,
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    size: u64,
    content: String,
}

#[derive(Debug, Deserialize)]
struct MariWorkspaceFile {
    path: String,
    content: String,
}

pub(crate) async fn professor_mari_prompt(state: &AppState, body: Value) -> AppResult<Value> {
    let input: MariPromptRequest =
        serde_json::from_value(body).map_err(|error| AppError::invalid_input(error.to_string()))?;
    let connection_value = resolve_llm_connection_for_request(
        state,
        &json!({
            "connectionId": input.connection_id,
        }),
    )?;
    let connection = llm_connection_from_value(&connection_value)?;
    let (content, action) = run_mari_agent(state, connection, &input).await?;

    Ok(json!({
        "content": content,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "action": action,
    }))
}

async fn run_mari_agent(
    state: &AppState,
    connection: marinara_llm::LlmConnection,
    input: &MariPromptRequest,
) -> AppResult<(String, Value)> {
    let workspace_seed = build_mari_workspace_seed(state)?;
    let session = MariShellSession::new(input, workspace_seed).await?;
    let tools = build_pi_like_tools(session.clone());
    let llm: Arc<dyn LLMProvider> = Arc::new(MarinaraLlmProvider::new(connection));
    let agent = ReActAgent::with_max_turns(ProfessorMariAgent { tools }, 8);
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
    Ok((content, staged_mari_action_contract(&session).await?))
}

#[derive(Clone)]
struct MarinaraLlmProvider {
    connection: marinara_llm::LlmConnection,
}

impl MarinaraLlmProvider {
    fn new(connection: marinara_llm::LlmConnection) -> Self {
        Self { connection }
    }

    async fn complete_chat(
        &self,
        messages: &[ChatMessage],
        sampling: Option<&SamplingOverrides>,
        tools: Option<&[Tool]>,
    ) -> Result<MarinaraChatResponse, LLMError> {
        let request_tools = tools
            .unwrap_or(&[])
            .iter()
            .map(|tool| serde_json::to_value(&tool.function).unwrap_or_else(|_| json!({})))
            .collect();
        let response = marinara_llm::complete_rich(marinara_llm::LlmRequest {
            connection: self.connection.clone(),
            messages: map_autoagents_messages(messages),
            parameters: sampling_parameters(sampling),
            tools: request_tools,
        })
        .await
        .map_err(|error| LLMError::ProviderError(format_app_error_for_debug(&error)))?;
        Ok(MarinaraChatResponse {
            content: response.content,
            tool_calls: map_marinara_tool_calls(response.tool_calls),
        })
    }
}

impl LLMProvider for MarinaraLlmProvider {}

#[async_trait]
impl ChatProvider for MarinaraLlmProvider {
    async fn chat_with_tools(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[Tool]>,
        _json_schema: Option<StructuredOutputFormat>,
    ) -> Result<Box<dyn ChatResponse>, LLMError> {
        Ok(Box::new(self.complete_chat(messages, None, tools).await?))
    }

    async fn chat_with_tools_and_sampling(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[Tool]>,
        _json_schema: Option<StructuredOutputFormat>,
        sampling: Option<&SamplingOverrides>,
    ) -> Result<Box<dyn ChatResponse>, LLMError> {
        Ok(Box::new(
            self.complete_chat(messages, sampling, tools).await?,
        ))
    }
}

#[async_trait]
impl CompletionProvider for MarinaraLlmProvider {
    async fn complete(
        &self,
        req: &CompletionRequest,
        _json_schema: Option<StructuredOutputFormat>,
    ) -> Result<CompletionResponse, LLMError> {
        let message = marinara_llm::LlmMessage {
            role: "user".to_string(),
            content: req.prompt.clone(),
            name: None,
            images: Vec::new(),
            tool_call_id: None,
            tool_calls: None,
        };
        let response = marinara_llm::complete(marinara_llm::LlmRequest {
            connection: self.connection.clone(),
            messages: vec![message],
            parameters: json!({
                "temperature": req.temperature,
                "maxTokens": req.max_tokens,
            }),
            tools: Vec::new(),
        })
        .await
        .map_err(|error| LLMError::ProviderError(format_app_error_for_debug(&error)))?;
        Ok(CompletionResponse { text: response })
    }
}

#[async_trait]
impl EmbeddingProvider for MarinaraLlmProvider {
    async fn embed(&self, _input: Vec<String>) -> Result<Vec<Vec<f32>>, LLMError> {
        Err(LLMError::ProviderError(
            "Marinara Professor Mari does not support embeddings".to_string(),
        ))
    }
}

#[async_trait]
impl ModelsProvider for MarinaraLlmProvider {
    async fn list_models(
        &self,
        _request: Option<&ModelListRequest>,
    ) -> Result<Box<dyn ModelListResponse>, LLMError> {
        Err(LLMError::ProviderError(
            "Marinara Professor Mari does not list models through AutoAgents".to_string(),
        ))
    }
}

#[derive(Debug)]
struct MarinaraChatResponse {
    content: String,
    tool_calls: Vec<ToolCall>,
}

impl ChatResponse for MarinaraChatResponse {
    fn text(&self) -> Option<String> {
        Some(self.content.clone())
    }

    fn tool_calls(&self) -> Option<Vec<autoagents::llm::ToolCall>> {
        (!self.tool_calls.is_empty()).then(|| self.tool_calls.clone())
    }
}

impl fmt::Display for MarinaraChatResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.content)
    }
}

fn map_autoagents_messages(messages: &[ChatMessage]) -> Vec<marinara_llm::LlmMessage> {
    let mut mapped = Vec::new();
    for message in messages {
        match &message.message_type {
            MessageType::ToolUse(tool_calls) => mapped.push(marinara_llm::LlmMessage {
                role: "assistant".to_string(),
                content: message.content.clone(),
                name: None,
                images: Vec::new(),
                tool_call_id: None,
                tool_calls: serde_json::to_value(tool_calls).ok(),
            }),
            MessageType::ToolResult(tool_results) => {
                for result in tool_results {
                    mapped.push(marinara_llm::LlmMessage {
                        role: "tool".to_string(),
                        content: result.function.arguments.clone(),
                        name: Some(result.function.name.clone()),
                        images: Vec::new(),
                        tool_call_id: Some(result.id.clone()),
                        tool_calls: None,
                    });
                }
            }
            MessageType::ImageURL(url) if is_http_image_url(url) => {
                mapped.push(marinara_llm::LlmMessage {
                    role: message.role.to_string(),
                    content: message.content.clone(),
                    name: None,
                    images: vec![url.clone()],
                    tool_call_id: None,
                    tool_calls: None,
                })
            }
            _ => mapped.push(marinara_llm::LlmMessage {
                role: message.role.to_string(),
                content: message.content.clone(),
                name: None,
                images: Vec::new(),
                tool_call_id: None,
                tool_calls: None,
            }),
        }
    }
    mapped
}

fn map_marinara_tool_calls(values: Vec<Value>) -> Vec<ToolCall> {
    values
        .into_iter()
        .filter_map(|value| {
            let id = value
                .get("id")
                .or_else(|| value.get("call_id"))
                .and_then(Value::as_str)
                .unwrap_or("tool_call")
                .to_string();
            let function = value.get("function").unwrap_or(&value);
            let name = function
                .get("name")
                .or_else(|| value.get("name"))
                .and_then(Value::as_str)?
                .to_string();
            let arguments = function
                .get("arguments")
                .or_else(|| value.get("arguments"))
                .and_then(Value::as_str)
                .unwrap_or("{}")
                .to_string();
            Some(ToolCall {
                id,
                call_type: value
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("function")
                    .to_string(),
                function: FunctionCall { name, arguments },
            })
        })
        .collect()
}

fn sampling_parameters(sampling: Option<&SamplingOverrides>) -> Value {
    let mut params = json!({
        "temperature": 0.35,
        "maxTokens": 2048,
    });
    if let Some(sampling) = sampling {
        if let Some(temperature) = sampling.temperature {
            params["temperature"] = json!(temperature);
        }
        if let Some(max_tokens) = sampling.max_tokens {
            params["maxTokens"] = json!(max_tokens);
        }
        if let Some(top_p) = sampling.top_p {
            params["topP"] = json!(top_p);
        }
    }
    params
}

fn build_task_prompt(input: &MariPromptRequest) -> String {
    let mut sections = vec![format!("System instructions:\n{MARI_SYSTEM_PROMPT}")];

    if let Some(persona) = build_persona_context(input.persona.as_ref()) {
        sections.push(format!("Selected user persona:\n{persona}"));
    }

    let history = input
        .messages
        .iter()
        .rev()
        .take(16)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .filter_map(|message| {
            let content = message.content.trim();
            (!content.is_empty()).then(|| format!("{}: {content}", message.role))
        })
        .collect::<Vec<_>>()
        .join("\n");
    if !history.is_empty() {
        sections.push(format!("Conversation history:\n{history}"));
    }

    if !input.attachments.is_empty() {
        sections.push(format!(
            "Latest turn attachments:\n{}",
            attachment_summary(&input.attachments)
        ));
    }

    sections.push(format!(
        "Latest user message:\n{}",
        input.user_message.trim()
    ));
    sections.join("\n\n")
}

fn build_persona_context(persona: Option<&MariPersonaContext>) -> Option<String> {
    let persona = persona?;
    let text = [
        ("Name", persona.name.as_deref()),
        ("Comment", persona.comment.as_deref()),
        ("Description", persona.description.as_deref()),
        ("Personality", persona.personality.as_deref()),
        ("Scenario", persona.scenario.as_deref()),
        ("Backstory", persona.backstory.as_deref()),
        ("Appearance", persona.appearance.as_deref()),
    ]
    .into_iter()
    .filter_map(|(label, value)| {
        let value = value?.trim();
        (!value.is_empty()).then(|| format!("{label}: {value}"))
    })
    .collect::<Vec<_>>()
    .join("\n");
    (!text.is_empty()).then_some(text)
}

fn attachment_summary(attachments: &[MariAttachment]) -> String {
    attachments
        .iter()
        .map(|attachment| {
            if attachment.r#type.to_ascii_lowercase().starts_with("image/") {
                return format!(
                    "- {} ({}, {} bytes): image attachment withheld from the LLM to avoid sending full base64 data.",
                    attachment.name, attachment.r#type, attachment.size
                );
            }

            let content = attachment.content.trim();
            let content = if content.chars().count() > MARI_TEXT_ATTACHMENT_CHAR_LIMIT {
                format!(
                    "{}\n\n[Attachment truncated after {} characters.]",
                    content.chars().take(MARI_TEXT_ATTACHMENT_CHAR_LIMIT).collect::<String>(),
                    MARI_TEXT_ATTACHMENT_CHAR_LIMIT
                )
            } else {
                content.to_string()
            };
            format!(
                "File: {}\nType: {}\nSize: {}\nContent:\n{}",
                attachment.name, attachment.r#type, attachment.size, content
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n---\n\n")
}

fn is_http_image_url(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://"))
        && (lower.ends_with(".png")
            || lower.ends_with(".jpg")
            || lower.ends_with(".jpeg")
            || lower.ends_with(".gif")
            || lower.ends_with(".webp"))
}

#[derive(Debug, Clone)]
struct MariWorkspaceFileRecord {
    path: String,
    content: String,
}

#[derive(Debug, Clone)]
struct MariWorkspaceBinding {
    entity: String,
    id: String,
    field: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct MariWorkspaceSeed {
    files: Vec<MariWorkspaceFileRecord>,
    bindings: BTreeMap<String, MariWorkspaceBinding>,
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

fn build_mari_workspace_seed(state: &AppState) -> AppResult<MariWorkspaceSeed> {
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

    let characters = list_storage_or_empty(state, "characters")?;
    add_flat_collection(
        &mut seed,
        &mut allocator,
        "characters",
        "/workspace/characters",
        "Untitled Character",
        &characters,
        &[
            "description",
            "personality",
            "scenario",
            "firstMessage",
            "first_message",
            "first_mes",
            "greeting",
            "mes_example",
            "exampleDialogue",
            "systemPrompt",
            "creatorNotes",
            "creator_notes",
            "data.description",
            "data.personality",
            "data.scenario",
            "data.first_mes",
            "data.mes_example",
            "data.creator_notes",
            "data.system_prompt",
            "data.post_history_instructions",
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
            string_field_path_owned(record, field).filter(|value| !value.trim().is_empty())
        {
            add_bound_file(
                seed,
                format!("{folder}/{}.md", field_file_name(field)),
                text,
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

fn record_label_for_entity(entity: &str, record: &Value, fallback: &str) -> String {
    let candidates: &[&str] = match entity {
        "characters" => &["data.name", "name", "title"],
        "personas" => &["name", "data.name", "title", "comment"],
        "lorebooks" => &["name", "title"],
        "lorebook-entries" => &["comment", "name"],
        "prompts" => &["name", "title"],
        "prompt-sections" => &["name", "title", "role", "type"],
        "prompt-groups" => &["name", "label", "title"],
        "prompt-variables" => &["name", "key", "label", "title"],
        _ => &["data.name", "name", "title", "label", "comment", "key"],
    };
    first_non_empty_owned(
        candidates
            .iter()
            .filter_map(|field| string_field_path_owned(record, field)),
    )
    .unwrap_or_else(|| fallback.to_string())
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

fn first_non_empty_owned(values: impl IntoIterator<Item = String>) -> Option<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
}

fn str_field<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str)
}

fn string_field_path_owned(value: &Value, field_path: &str) -> Option<String> {
    fn walk(current: &Value, parts: &[&str]) -> Option<String> {
        if parts.is_empty() {
            return current.as_str().map(str::to_string);
        }
        if let Some(object) = current.as_object() {
            return walk(object.get(parts[0])?, &parts[1..]);
        }
        if let Some(raw) = current.as_str() {
            let parsed = serde_json::from_str::<Value>(raw).ok()?;
            return walk(&parsed, parts);
        }
        None
    }
    let parts = field_path.split('.').collect::<Vec<_>>();
    walk(value, &parts)
}

fn display_label(label: &str) -> String {
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
        Some(Value::String(raw)) => serde_json::from_str::<Vec<String>>(raw)
            .unwrap_or_else(|_| raw.lines().map(str::to_string).collect()),
        _ => Vec::new(),
    }
}

fn keys_text(record: &Value) -> Option<String> {
    let keys = string_array_items(record.get("keys").or_else(|| record.get("keywords")));
    (!keys.is_empty()).then(|| keys.join("\n"))
}

fn metadata_without_fields(record: &Value, text_fields: &[&str]) -> Value {
    let mut metadata = record.clone();
    expand_json_string_objects(&mut metadata);
    remove_field_path(&mut metadata, "id");
    remove_field_path(&mut metadata, "createdAt");
    remove_field_path(&mut metadata, "updatedAt");
    for field in text_fields {
        remove_field_path(&mut metadata, field);
    }
    sanitize_metadata_value(&mut metadata);
    metadata
}

fn expand_json_string_objects(value: &mut Value) {
    match value {
        Value::Object(object) => {
            for child in object.values_mut() {
                expand_json_string_objects(child);
            }
        }
        Value::Array(items) => {
            for item in items {
                expand_json_string_objects(item);
            }
        }
        Value::String(raw) => {
            if let Ok(parsed @ (Value::Object(_) | Value::Array(_))) =
                serde_json::from_str::<Value>(raw)
            {
                *value = parsed;
                expand_json_string_objects(value);
            }
        }
        _ => {}
    }
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

fn field_file_name(field: &str) -> String {
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
    let mut lines = vec![format!("# {}", title_case(name)), String::new()];
    if entries.is_empty() {
        lines.push("No records found.".to_string());
    } else {
        lines.extend(entries);
    }
    lines.join("\n")
}

fn singular_title(name: &str) -> String {
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

#[derive(Clone)]
struct MariShellSession {
    fs: Arc<TrackingFs>,
    bash: Arc<Mutex<Bash>>,
    initial_files: Arc<RwLock<BTreeMap<String, Vec<u8>>>>,
    manifest: Arc<BTreeMap<String, MariWorkspaceBinding>>,
}

impl MariShellSession {
    async fn new(
        input: &MariPromptRequest,
        workspace_seed: MariWorkspaceSeed,
    ) -> AppResult<Arc<Self>> {
        let fs = Arc::new(TrackingFs::new());
        fs.add_text_file("/workspace/system-prompt.md", MARI_SYSTEM_PROMPT);
        fs.add_text_file("/workspace/README.md", PROF_MARI_WORKSPACE_README);
        if let Some(persona) = build_persona_context(input.persona.as_ref()) {
            fs.add_text_file("/workspace/active-persona.md", &persona);
        }
        for file in &workspace_seed.files {
            fs.add_text_file(&file.path, &file.content);
        }
        for file in &input.workspace_files {
            let path = resolve_virtual_path(&file.path);
            fs.add_text_file(&path, &file.content);
        }
        for attachment in &input.attachments {
            if !attachment.r#type.to_ascii_lowercase().starts_with("image/") {
                let safe_name = sanitize_filename(&attachment.name);
                fs.add_text_file(
                    format!("/workspace/attachments/{safe_name}").as_str(),
                    &attachment.content,
                );
            }
        }
        let bash = Bash::builder()
            .fs(fs.clone())
            .cwd("/workspace")
            .env("HOME", "/workspace")
            .env("USER", "prof-mari")
            .build();
        let session = Arc::new(Self {
            fs,
            bash: Arc::new(Mutex::new(bash)),
            initial_files: Arc::new(RwLock::new(BTreeMap::new())),
            manifest: Arc::new(workspace_seed.bindings),
        });
        let initial = session.snapshot_review_files().await?;
        *session.initial_files.write().unwrap() = initial;
        Ok(session)
    }

    async fn exec_bash(&self, command: &str) -> AppResult<Value> {
        let mut bash = self.bash.lock().await;
        let output = bash
            .exec(command)
            .await
            .map_err(|error| AppError::new("mari_bash_failed", error.to_string()))?;
        drop(bash);
        Ok(json!({
            "stdout": truncate_tool_text(&output.stdout),
            "stderr": truncate_tool_text(&output.stderr),
            "exitCode": output.exit_code,
            "pendingChanges": self.pending_changes().await?,
        }))
    }

    async fn read_text(&self, path: &str) -> AppResult<String> {
        let path = resolve_virtual_path(path);
        let bytes = self
            .fs
            .read_file(Path::new(&path))
            .await
            .map_err(|error| AppError::new("mari_read_failed", error.to_string()))?;
        Ok(String::from_utf8_lossy(&bytes).to_string())
    }

    async fn write_text(&self, path: &str, content: &str) -> AppResult<Value> {
        let path = resolve_virtual_path(path);
        ensure_parent_dirs(&self.fs, Path::new(&path)).await?;
        self.fs
            .write_file(Path::new(&path), content.as_bytes())
            .await
            .map_err(|error| AppError::new("mari_write_failed", error.to_string()))?;
        Ok(json!({ "path": path, "pendingChanges": self.pending_changes().await? }))
    }

    async fn edit_text(&self, path: &str, old_text: &str, new_text: &str) -> AppResult<Value> {
        let path = resolve_virtual_path(path);
        let current = self.read_text(&path).await?;
        let matches = current.matches(old_text).count();
        if matches != 1 {
            return Err(AppError::invalid_input(format!(
                "edit expected oldText to match exactly once, found {matches} matches"
            )));
        }
        let updated = current.replacen(old_text, new_text, 1);
        self.write_text(&path, &updated).await
    }

    async fn pending_changes(&self) -> AppResult<Vec<Value>> {
        let current = self.snapshot_review_files().await?;
        let initial = self.initial_files.read().unwrap().clone();
        Ok(diff_file_maps(&initial, &current))
    }

    fn manifest_summary(&self) -> Value {
        let mut by_entity: BTreeMap<&str, usize> = BTreeMap::new();
        let mut text_field_bindings = 0usize;
        for binding in self.manifest.values() {
            *by_entity.entry(binding.entity.as_str()).or_default() += 1;
            if binding
                .field
                .as_deref()
                .is_some_and(|field| field != "metadata")
            {
                text_field_bindings += 1;
            }
            let _ = binding.id.as_str();
        }
        json!({
            "boundFiles": self.manifest.len(),
            "textFieldBindings": text_field_bindings,
            "byEntity": by_entity,
        })
    }

    async fn snapshot_review_files(&self) -> AppResult<BTreeMap<String, Vec<u8>>> {
        let mut files = BTreeMap::new();
        collect_files_recursive(&self.fs, Path::new("/workspace"), &mut files).await?;
        Ok(files)
    }
}

const PROF_MARI_WORKSPACE_README: &str = "# Prof Mari virtual workspace\n\nThis is an isolated bash workspace populated from the user's Marinara creative library. Start at `/workspace/index.md`, then inspect folders such as `characters/`, `personas/`, `lorebooks/`, and `prompts/`. Paths are descriptive and duplicate-safe; Marinara tracks hidden storage IDs internally. Changes remain staged for user review.\n";

struct TrackingFs {
    inner: InMemoryFs,
}

impl fmt::Debug for TrackingFs {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TrackingFs").finish()
    }
}

impl TrackingFs {
    fn new() -> Self {
        Self {
            inner: InMemoryFs::new(),
        }
    }

    fn add_text_file(&self, path: &str, content: &str) {
        self.inner.add_file(path, content.as_bytes(), 0o644);
    }
}

#[bashkit_async_trait]
impl FileSystemExt for TrackingFs {
    fn usage(&self) -> bashkit::FsUsage {
        self.inner.usage()
    }

    fn limits(&self) -> bashkit::FsLimits {
        self.inner.limits()
    }

    fn vfs_snapshot(&self) -> Option<bashkit::VfsSnapshot> {
        self.inner.vfs_snapshot()
    }

    fn vfs_restore(&self, snapshot: &bashkit::VfsSnapshot) -> bashkit::Result<()> {
        self.inner.vfs_restore(snapshot)
    }
}

#[bashkit_async_trait]
impl FileSystem for TrackingFs {
    async fn read_file(&self, path: &Path) -> bashkit::Result<Vec<u8>> {
        self.inner.read_file(path).await
    }
    async fn write_file(&self, path: &Path, content: &[u8]) -> bashkit::Result<()> {
        self.inner.write_file(path, content).await
    }
    async fn append_file(&self, path: &Path, content: &[u8]) -> bashkit::Result<()> {
        self.inner.append_file(path, content).await
    }
    async fn mkdir(&self, path: &Path, recursive: bool) -> bashkit::Result<()> {
        self.inner.mkdir(path, recursive).await
    }
    async fn remove(&self, path: &Path, recursive: bool) -> bashkit::Result<()> {
        self.inner.remove(path, recursive).await
    }
    async fn stat(&self, path: &Path) -> bashkit::Result<Metadata> {
        self.inner.stat(path).await
    }
    async fn read_dir(&self, path: &Path) -> bashkit::Result<Vec<DirEntry>> {
        self.inner.read_dir(path).await
    }
    async fn exists(&self, path: &Path) -> bashkit::Result<bool> {
        self.inner.exists(path).await
    }
    async fn rename(&self, from: &Path, to: &Path) -> bashkit::Result<()> {
        self.inner.rename(from, to).await
    }
    async fn copy(&self, from: &Path, to: &Path) -> bashkit::Result<()> {
        self.inner.copy(from, to).await
    }
    async fn symlink(&self, target: &Path, link: &Path) -> bashkit::Result<()> {
        self.inner.symlink(target, link).await
    }
    async fn read_link(&self, path: &Path) -> bashkit::Result<PathBuf> {
        self.inner.read_link(path).await
    }
    async fn chmod(&self, path: &Path, mode: u32) -> bashkit::Result<()> {
        self.inner.chmod(path, mode).await
    }
    async fn set_modified_time(&self, path: &Path, time: SystemTime) -> bashkit::Result<()> {
        self.inner.set_modified_time(path, time).await
    }
}

#[derive(Debug, Clone, Copy)]
enum PiToolKind {
    Read,
    Bash,
    Edit,
    Write,
}

#[derive(Clone)]
struct PiLikeTool {
    kind: PiToolKind,
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
        let result = match self.kind {
            PiToolKind::Read => self.tool_read(args).await,
            PiToolKind::Bash => self.tool_bash(args).await,
            PiToolKind::Edit => self.tool_edit(args).await,
            PiToolKind::Write => self.tool_write(args).await,
        };
        result.map_err(tool_runtime_error)
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
            PiToolKind::Read => "Read a text file from the virtual workspace. Supports optional 1-indexed offset and line limit.",
            PiToolKind::Bash => "Execute bash commands in the isolated virtual workspace. File changes are staged and returned as pendingChanges.",
            PiToolKind::Edit => "Edit a text file using exact text replacement. oldText must match exactly once.",
            PiToolKind::Write => "Create or overwrite a text file in the virtual workspace.",
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
        let content = self.session.read_text(path).await?;
        let lines: Vec<&str> = content.lines().collect();
        let selected = lines
            .iter()
            .skip(offset - 1)
            .take(limit.unwrap_or(usize::MAX))
            .copied()
            .collect::<Vec<_>>()
            .join("\n");
        Ok(
            json!({"path": resolve_virtual_path(path), "content": truncate_tool_text(&selected), "totalLines": lines.len()}),
        )
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

fn build_pi_like_tools(session: Arc<MariShellSession>) -> Vec<Arc<dyn ToolT>> {
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

fn resolve_virtual_path(path: &str) -> String {
    let trimmed = path.trim();
    let raw = if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/workspace/{trimmed}")
    };
    normalize_virtual_path(&raw)
}

fn normalize_virtual_path(path: &str) -> String {
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    format!("/{}", parts.join("/"))
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "attachment.txt".to_string()
    } else {
        cleaned
    }
}

async fn ensure_parent_dirs(fs: &TrackingFs, path: &Path) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs.mkdir(parent, true)
            .await
            .map_err(|error| AppError::new("mari_mkdir_failed", error.to_string()))?;
    }
    Ok(())
}

async fn collect_files_recursive(
    fs: &TrackingFs,
    path: &Path,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> AppResult<()> {
    if !fs
        .exists(path)
        .await
        .map_err(|error| AppError::new("mari_fs_failed", error.to_string()))?
    {
        return Ok(());
    }
    let meta = fs
        .stat(path)
        .await
        .map_err(|error| AppError::new("mari_fs_failed", error.to_string()))?;
    if meta.file_type == FileType::File {
        let content = fs
            .read_file(path)
            .await
            .map_err(|error| AppError::new("mari_fs_failed", error.to_string()))?;
        files.insert(path.to_string_lossy().to_string(), content);
        return Ok(());
    }
    if meta.file_type == FileType::Directory {
        for entry in fs
            .read_dir(path)
            .await
            .map_err(|error| AppError::new("mari_fs_failed", error.to_string()))?
        {
            let child = path.join(entry.name);
            Box::pin(collect_files_recursive(fs, &child, files)).await?;
        }
    }
    Ok(())
}

fn diff_file_maps(
    before: &BTreeMap<String, Vec<u8>>,
    after: &BTreeMap<String, Vec<u8>>,
) -> Vec<Value> {
    let paths = before
        .keys()
        .chain(after.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    paths.into_iter().filter_map(|path| {
        match (before.get(&path), after.get(&path)) {
            (None, Some(after)) => Some(json!({"op":"create", "path": path, "after": text_preview(after)})),
            (Some(before), None) => Some(json!({"op":"delete", "path": path, "before": text_preview(before)})),
            (Some(before), Some(after)) if before != after => Some(json!({"op":"modify", "path": path, "before": text_preview(before), "after": text_preview(after)})),
            _ => None,
        }
    }).collect()
}

fn text_preview(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    truncate_tool_text(&text)
}

fn truncate_tool_text(text: &str) -> String {
    if text.chars().count() > MARI_TOOL_TEXT_LIMIT {
        format!(
            "{}\n[truncated after {} characters]",
            text.chars().take(MARI_TOOL_TEXT_LIMIT).collect::<String>(),
            MARI_TOOL_TEXT_LIMIT
        )
    } else {
        text.to_string()
    }
}

async fn staged_mari_action_contract(session: &MariShellSession) -> AppResult<Value> {
    let changes = session.pending_changes().await?;
    Ok(json!({
        "type": if changes.is_empty() { "none" } else { "staged_file_changes" },
        "capability": "bashkit_virtual_workspace",
        "changes": changes,
        "workspaceManifest": session.manifest_summary(),
        "approvalRequired": !changes.is_empty(),
    }))
}

fn format_app_error_for_debug(error: &AppError) -> String {
    let mut message = error.to_string();
    if let Some(details) = &error.details {
        let details = serde_json::to_string_pretty(details).unwrap_or_else(|serialize_error| {
            format!("Could not serialize error details: {serialize_error}")
        });
        message.push_str("\nProvider debug details:\n");
        message.push_str(&details.chars().take(12_000).collect::<String>());
    }
    message
}
