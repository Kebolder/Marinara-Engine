use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Map, Value};

pub(crate) fn delete_connection(state: &AppState, id: &str, force: bool) -> AppResult<Value> {
    if state.storage.get("connections", id)?.is_none() {
        return Err(AppError::not_found("Connection not found"));
    }

    let agents = reference_rows(state, "agents", id, &["id", "type", "name"])?;
    let chats = reference_rows(state, "chats", id, &["id", "name"])?;
    let has_references = !agents.is_empty() || !chats.is_empty();

    if has_references && !force {
        return Err(AppError::with_details(
            "connection_in_use",
            connection_in_use_message(agents.len(), chats.len()),
            json!({
                "agents": agents,
                "chats": chats,
            }),
        ));
    }

    if force {
        clear_reference_rows(state, "agents", &agents)?;
        clear_reference_rows(state, "chats", &chats)?;
    }

    let deleted = state.storage.delete("connections", id)?;
    let mut result = Map::new();
    result.insert("deleted".to_string(), Value::Bool(deleted));
    if force && has_references {
        result.insert(
            "cleared".to_string(),
            json!({
                "agents": agents.len(),
                "chats": chats.len(),
            }),
        );
    }
    Ok(Value::Object(result))
}

fn connection_in_use_message(agent_count: usize, chat_count: usize) -> String {
    let mut parts = Vec::new();
    if agent_count > 0 {
        parts.push(format!(
            "{} agent{}",
            agent_count,
            if agent_count == 1 { "" } else { "s" }
        ));
    }
    if chat_count > 0 {
        parts.push(format!(
            "{} chat{}",
            chat_count,
            if chat_count == 1 { "" } else { "s" }
        ));
    }
    format!(
        "This connection is still used by {}. Repoint those records before deleting it.",
        parts.join(" and ")
    )
}

fn reference_rows(
    state: &AppState,
    collection: &str,
    connection_id: &str,
    fields: &[&str],
) -> AppResult<Vec<Value>> {
    let mut filters = Map::new();
    filters.insert(
        "connectionId".to_string(),
        Value::String(connection_id.to_string()),
    );
    state
        .storage
        .list_where(collection, &filters)?
        .into_iter()
        .map(|row| slim_row(row, fields))
        .collect()
}

fn slim_row(row: Value, fields: &[&str]) -> AppResult<Value> {
    let object = row
        .as_object()
        .ok_or_else(|| AppError::invalid_input("Referenced record is not an object"))?;
    let mut slim = Map::new();
    for field in fields {
        if let Some(value) = object.get(*field) {
            slim.insert((*field).to_string(), value.clone());
        }
    }
    Ok(Value::Object(slim))
}

fn clear_reference_rows(state: &AppState, collection: &str, rows: &[Value]) -> AppResult<()> {
    for row in rows {
        let Some(id) = row.get("id").and_then(Value::as_str) else {
            continue;
        };
        state
            .storage
            .patch(collection, id, json!({ "connectionId": null }))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use marinara_core::now_millis;
    use serde_json::json;
    use std::fs;

    fn test_state(name: &str) -> AppState {
        let root = std::env::temp_dir().join(format!("marinara-{name}-{}", now_millis()));
        AppState::from_data_dir(&root, Vec::new()).expect("test state should be created")
    }

    fn cleanup(state: &AppState) {
        let _ = fs::remove_dir_all(&state.data_dir);
    }

    #[test]
    fn connection_delete_rejects_agent_and_chat_references() {
        let state = test_state("connection-delete-rejects");
        state
            .storage
            .create("connections", json!({ "id": "conn-a", "name": "Default" }))
            .expect("connection");
        state
            .storage
            .create(
                "agents",
                json!({ "id": "agent-a", "type": "director", "name": "Director", "connectionId": "conn-a" }),
            )
            .expect("agent");
        state
            .storage
            .create(
                "chats",
                json!({ "id": "chat-a", "name": "Session", "connectionId": "conn-a" }),
            )
            .expect("chat");

        let err = delete_connection(&state, "conn-a", false).expect_err("delete should be blocked");
        assert_eq!(err.code, "connection_in_use");
        assert!(err.message.contains("1 agent"));
        assert!(err.message.contains("1 chat"));
        assert!(state
            .storage
            .get("connections", "conn-a")
            .unwrap()
            .is_some());
        cleanup(&state);
    }

    #[test]
    fn force_connection_delete_clears_references() {
        let state = test_state("connection-delete-force");
        state
            .storage
            .create("connections", json!({ "id": "conn-a", "name": "Default" }))
            .expect("connection");
        state
            .storage
            .create(
                "agents",
                json!({ "id": "agent-a", "type": "director", "name": "Director", "connectionId": "conn-a" }),
            )
            .expect("agent");
        state
            .storage
            .create(
                "chats",
                json!({ "id": "chat-a", "name": "Session", "connectionId": "conn-a" }),
            )
            .expect("chat");

        let result =
            delete_connection(&state, "conn-a", true).expect("force delete should succeed");
        assert_eq!(result["deleted"], true);
        assert_eq!(result["cleared"]["agents"], 1);
        assert_eq!(result["cleared"]["chats"], 1);
        assert!(state
            .storage
            .get("connections", "conn-a")
            .unwrap()
            .is_none());
        assert!(state
            .storage
            .get("agents", "agent-a")
            .unwrap()
            .unwrap()
            .get("connectionId")
            .unwrap()
            .is_null());
        assert!(state
            .storage
            .get("chats", "chat-a")
            .unwrap()
            .unwrap()
            .get("connectionId")
            .unwrap()
            .is_null());
        cleanup(&state);
    }
}
