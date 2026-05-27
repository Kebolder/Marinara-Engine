use super::types::{MariAttachment, MariPersonaContext, MariPromptRequest};
use super::{MARI_SYSTEM_PROMPT, MARI_TEXT_ATTACHMENT_CHAR_LIMIT};

pub(crate) fn build_task_prompt(input: &MariPromptRequest) -> String {
    let mut sections = vec![format!("System instructions:\n{MARI_SYSTEM_PROMPT}")];

    if let Some(persona) = build_persona_context(input.persona.as_ref()) {
        sections.push(format!("Selected user persona:\n{persona}"));
    }

    if let Some(summary) = input
        .compacted_summary
        .as_deref()
        .map(str::trim)
        .filter(|summary| !summary.is_empty())
    {
        sections.push(format!("Compacted conversation so far:\n{summary}"));
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

pub(crate) fn build_persona_context(persona: Option<&MariPersonaContext>) -> Option<String> {
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
