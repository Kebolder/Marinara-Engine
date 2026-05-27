use super::shell::MariShellSession;
use super::util;
use super::{MARI_MODEL_OUTPUT_TOKENS, MARI_SYSTEM_PROMPT};
use autoagents::async_trait;
use autoagents::core::agent::AgentDeriveT;
use autoagents::core::tool::{shared_tools_to_boxes, ToolT};
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
use serde_json::{json, Value};
use std::fmt;
use std::sync::Arc;

#[derive(Clone, AgentHooks)]
pub(crate) struct ProfessorMariAgent {
    pub(crate) tools: Vec<Arc<dyn ToolT>>,
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

#[derive(Clone)]
pub(crate) struct MarinaraLlmProvider {
    connection: marinara_llm::LlmConnection,
    session: Arc<MariShellSession>,
}

impl MarinaraLlmProvider {
    pub(crate) fn new(
        connection: marinara_llm::LlmConnection,
        session: Arc<MariShellSession>,
    ) -> Self {
        Self {
            connection,
            session,
        }
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
        .map_err(|error| LLMError::ProviderError(util::format_app_error_for_debug(&error)))?;
        self.session.record_trace(json!({
            "type": "model_turn",
            "label": "Model turn",
            "summary": model_turn_summary(&response.content, &response.tool_calls),
            "content": util::truncate_tool_text(response.content.trim()),
            "toolCalls": response.tool_calls.iter().map(summarize_tool_call_value).collect::<Vec<_>>(),
        }));
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
        .map_err(|error| LLMError::ProviderError(util::format_app_error_for_debug(&error)))?;
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

fn model_turn_summary(content: &str, tool_calls: &[Value]) -> String {
    if !tool_calls.is_empty() {
        let names = tool_calls
            .iter()
            .filter_map(tool_call_name)
            .collect::<Vec<_>>()
            .join(", ");
        if names.is_empty() {
            format!("Requested {} tool call(s).", tool_calls.len())
        } else {
            format!("Requested tool call(s): {names}.")
        }
    } else if !content.trim().is_empty() {
        "Prepared final reply.".to_string()
    } else {
        "Completed a model turn.".to_string()
    }
}

fn summarize_tool_call_value(value: &Value) -> Value {
    let function = value.get("function").unwrap_or(value);
    json!({
        "id": value.get("id").or_else(|| value.get("call_id")).cloned().unwrap_or(Value::Null),
        "name": tool_call_name(value).unwrap_or("tool").to_string(),
        "arguments": function.get("arguments").or_else(|| value.get("arguments")).cloned().unwrap_or_else(|| json!("{}")),
    })
}

fn tool_call_name(value: &Value) -> Option<&str> {
    value
        .get("function")
        .and_then(|function| function.get("name"))
        .or_else(|| value.get("name"))
        .and_then(Value::as_str)
}

fn sampling_parameters(sampling: Option<&SamplingOverrides>) -> Value {
    let mut params = json!({
        "temperature": 0.35,
    });
    if MARI_MODEL_OUTPUT_TOKENS > 0 {
        params["maxTokens"] = json!(MARI_MODEL_OUTPUT_TOKENS);
    }
    if let Some(sampling) = sampling {
        if let Some(temperature) = sampling.temperature {
            params["temperature"] = json!(temperature);
        }
        if let Some(max_tokens) = sampling.max_tokens {
            if max_tokens > 0 {
                params["maxTokens"] = json!(max_tokens);
            } else {
                params
                    .as_object_mut()
                    .map(|object| object.remove("maxTokens"));
            }
        }
        if let Some(top_p) = sampling.top_p {
            params["topP"] = json!(top_p);
        }
    }
    params
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
