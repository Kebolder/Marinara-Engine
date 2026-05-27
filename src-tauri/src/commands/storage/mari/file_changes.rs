use super::util;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub(crate) struct MariFileChange {
    pub(crate) op: String,
    pub(crate) path: String,
    pub(crate) before: Option<Vec<u8>>,
    pub(crate) after: Option<Vec<u8>>,
}

pub(crate) fn diff_file_maps_full(
    before: &BTreeMap<String, Vec<u8>>,
    after: &BTreeMap<String, Vec<u8>>,
) -> Vec<MariFileChange> {
    let paths = before
        .keys()
        .chain(after.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    paths
        .into_iter()
        .filter_map(|path| match (before.get(&path), after.get(&path)) {
            (None, Some(after)) => Some(MariFileChange {
                op: "create".to_string(),
                path,
                before: None,
                after: Some(after.clone()),
            }),
            (Some(before), None) => Some(MariFileChange {
                op: "delete".to_string(),
                path,
                before: Some(before.clone()),
                after: None,
            }),
            (Some(before), Some(after)) if before != after => Some(MariFileChange {
                op: "modify".to_string(),
                path,
                before: Some(before.clone()),
                after: Some(after.clone()),
            }),
            _ => None,
        })
        .collect()
}

pub(crate) fn file_change_summary(change: &MariFileChange) -> Value {
    let mut value = Map::new();
    value.insert("op".to_string(), Value::String(change.op.clone()));
    value.insert("path".to_string(), Value::String(change.path.clone()));
    if let Some(before) = &change.before {
        value.insert("before".to_string(), Value::String(text_preview(before)));
    }
    if let Some(after) = &change.after {
        value.insert("after".to_string(), Value::String(text_preview(after)));
    }
    Value::Object(value)
}

pub(crate) fn text_preview(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    util::truncate_tool_text(&text)
}
