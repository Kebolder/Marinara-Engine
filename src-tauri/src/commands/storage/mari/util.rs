use super::MARI_TOOL_TEXT_LIMIT;
use marinara_core::AppError;

pub(crate) fn resolve_virtual_path(path: &str) -> String {
    let trimmed = path.trim();
    let raw = if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/workspace/{trimmed}")
    };
    normalize_virtual_path(&raw)
}

pub(crate) fn normalize_virtual_path(path: &str) -> String {
    let normalized_separators = path.replace('\\', "/");
    let mut parts = Vec::new();
    for part in normalized_separators.split('/') {
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

pub(crate) fn sanitize_filename(name: &str) -> String {
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

pub(crate) fn truncate_tool_text(text: &str) -> String {
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

pub(crate) fn format_app_error_for_debug(error: &AppError) -> String {
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
