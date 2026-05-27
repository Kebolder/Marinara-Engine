use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MariPromptRequest {
    pub(crate) user_message: String,
    #[serde(default)]
    pub(crate) messages: Vec<MariPromptMessage>,
    #[serde(default)]
    pub(crate) compacted_summary: Option<String>,
    #[serde(default)]
    pub(crate) connection_id: Option<String>,
    #[serde(default)]
    pub(crate) persona: Option<MariPersonaContext>,
    #[serde(default)]
    pub(crate) attachments: Vec<MariAttachment>,
    #[serde(default)]
    pub(crate) workspace_files: Vec<MariWorkspaceFile>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MariPromptMessage {
    pub(crate) role: String,
    pub(crate) content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MariPersonaContext {
    pub(crate) name: Option<String>,
    pub(crate) comment: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) personality: Option<String>,
    pub(crate) scenario: Option<String>,
    pub(crate) backstory: Option<String>,
    pub(crate) appearance: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MariAttachment {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) r#type: String,
    #[serde(default)]
    pub(crate) size: u64,
    pub(crate) content: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MariWorkspaceFile {
    pub(crate) path: String,
    pub(crate) content: String,
}
