use super::file_changes::{self, MariFileChange};
use super::prompt;
use super::types::MariPromptRequest;
use super::util;
use super::workspace::{MariWorkspaceBinding, MariWorkspaceSeed};
use super::MARI_SYSTEM_PROMPT;
use bashkit::{
    async_trait as bashkit_async_trait, Bash, DirEntry, FileSystem, FileSystemExt, FileType,
    InMemoryFs, Metadata, VfsSnapshot,
};
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::SystemTime;
use tokio::sync::Mutex;

#[derive(Clone)]
pub(crate) struct MariShellSession {
    fs: Arc<TrackingFs>,
    bash: Arc<Mutex<Bash>>,
    initial_files: Arc<RwLock<BTreeMap<String, Vec<u8>>>>,
    manifest: Arc<RwLock<BTreeMap<String, MariWorkspaceBinding>>>,
    trace: Arc<RwLock<Vec<Value>>>,
    trace_channel: Option<tauri::ipc::Channel<Value>>,
    tool_review_lock: Arc<Mutex<()>>,
    approval_sequence: Arc<std::sync::atomic::AtomicU64>,
}

impl MariShellSession {
    pub(crate) async fn new(
        input: &MariPromptRequest,
        workspace_seed: MariWorkspaceSeed,
        trace_channel: Option<tauri::ipc::Channel<Value>>,
    ) -> AppResult<Arc<Self>> {
        let fs = Arc::new(TrackingFs::new());
        fs.add_text_file("/workspace/system-prompt.md", MARI_SYSTEM_PROMPT);
        fs.add_text_file("/workspace/README.md", PROF_MARI_WORKSPACE_README);
        if let Some(persona) = prompt::build_persona_context(input.persona.as_ref()) {
            fs.add_text_file("/workspace/active-persona.md", &persona);
        }
        for file in &workspace_seed.files {
            fs.add_text_file(&file.path, &file.content);
        }
        for file in &input.workspace_files {
            let path = util::resolve_virtual_path(&file.path);
            fs.add_text_file(&path, &file.content);
        }
        for attachment in &input.attachments {
            if !attachment.r#type.to_ascii_lowercase().starts_with("image/") {
                let safe_name = util::sanitize_filename(&attachment.name);
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
            manifest: Arc::new(RwLock::new(workspace_seed.bindings)),
            trace: Arc::new(RwLock::new(Vec::new())),
            trace_channel,
            tool_review_lock: Arc::new(Mutex::new(())),
            approval_sequence: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        });
        let initial = session.snapshot_review_files().await?;
        *session.initial_files.write().unwrap() = initial;
        Ok(session)
    }

    pub(crate) async fn exec_bash(&self, command: &str) -> AppResult<Value> {
        let mut bash = self.bash.lock().await;
        let output = bash
            .exec(command)
            .await
            .map_err(|error| AppError::new("mari_bash_failed", error.to_string()))?;
        drop(bash);
        Ok(json!({
            "stdout": util::truncate_tool_text(&output.stdout),
            "stderr": util::truncate_tool_text(&output.stderr),
            "exitCode": output.exit_code,
            "pendingChanges": self.pending_changes().await?,
        }))
    }

    pub(crate) async fn read_text(&self, path: &str) -> AppResult<String> {
        let path = util::resolve_virtual_path(path);
        let bytes = self
            .fs
            .read_file(Path::new(&path))
            .await
            .map_err(|error| AppError::new("mari_read_failed", error.to_string()))?;
        Ok(String::from_utf8_lossy(&bytes).to_string())
    }

    pub(crate) async fn read_for_tool(
        &self,
        path: &str,
        offset: usize,
        limit: Option<usize>,
    ) -> AppResult<Value> {
        let path = util::resolve_virtual_path(path);
        let metadata = self
            .fs
            .stat(Path::new(&path))
            .await
            .map_err(|error| AppError::new("mari_read_failed", error.to_string()))?;

        if metadata.file_type == FileType::Directory {
            return self.read_directory_for_tool(&path, offset, limit).await;
        }

        self.read_file_for_tool(&path, "file", None, offset, limit)
            .await
    }

    pub(crate) async fn write_text(&self, path: &str, content: &str) -> AppResult<Value> {
        let path = util::resolve_virtual_path(path);
        ensure_parent_dirs(&self.fs, Path::new(&path)).await?;
        self.fs
            .write_file(Path::new(&path), content.as_bytes())
            .await
            .map_err(|error| AppError::new("mari_write_failed", error.to_string()))?;
        Ok(json!({ "path": path, "pendingChanges": self.pending_changes().await? }))
    }

    pub(crate) async fn edit_text(
        &self,
        path: &str,
        old_text: &str,
        new_text: &str,
    ) -> AppResult<Value> {
        let path = util::resolve_virtual_path(path);
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

    pub(crate) async fn pending_file_changes(&self) -> AppResult<Vec<MariFileChange>> {
        let current = self.snapshot_review_files().await?;
        let initial = self.initial_files.read().unwrap().clone();
        Ok(file_changes::diff_file_maps_full(&initial, &current))
    }

    pub(crate) async fn review_files_snapshot(&self) -> AppResult<BTreeMap<String, Vec<u8>>> {
        self.snapshot_review_files().await
    }

    pub(crate) fn vfs_snapshot(&self) -> AppResult<VfsSnapshot> {
        self.fs.vfs_snapshot().ok_or_else(|| {
            AppError::new(
                "mari_workspace_snapshot_failed",
                "Virtual workspace snapshots are not available",
            )
        })
    }

    pub(crate) fn restore_vfs_snapshot(&self, snapshot: &VfsSnapshot) -> AppResult<()> {
        self.fs
            .vfs_restore(snapshot)
            .map_err(|error| AppError::new("mari_workspace_restore_failed", error.to_string()))
    }

    pub(crate) async fn accept_current_as_baseline(&self) -> AppResult<()> {
        let current = self.snapshot_review_files().await?;
        self.accept_files_as_baseline(current);
        Ok(())
    }

    pub(crate) fn accept_files_as_baseline(&self, files: BTreeMap<String, Vec<u8>>) {
        *self.initial_files.write().unwrap() = files;
    }

    pub(crate) async fn pending_changes(&self) -> AppResult<Vec<Value>> {
        Ok(self
            .pending_file_changes()
            .await?
            .iter()
            .map(file_changes::file_change_summary)
            .collect())
    }

    pub(crate) fn record_trace(&self, event: Value) {
        self.trace.write().unwrap().push(event.clone());
        if let Some(channel) = &self.trace_channel {
            let _ = channel.send(json!({ "type": "trace", "event": event }));
        }
    }

    pub(crate) fn trace_events(&self) -> Vec<Value> {
        self.trace.read().unwrap().clone()
    }

    pub(crate) fn manifest_summary(&self) -> Value {
        let mut by_entity: BTreeMap<&str, usize> = BTreeMap::new();
        let mut text_field_bindings = 0usize;
        let manifest = self.manifest.read().unwrap();
        for binding in manifest.values() {
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
            "boundFiles": manifest.len(),
            "textFieldBindings": text_field_bindings,
            "byEntity": by_entity,
        })
    }

    pub(crate) fn manifest_snapshot(&self) -> BTreeMap<String, MariWorkspaceBinding> {
        self.manifest.read().unwrap().clone()
    }

    pub(crate) fn bind_workspace_file(
        &self,
        path: String,
        entity: String,
        id: String,
        field: String,
    ) {
        self.manifest.write().unwrap().insert(
            path,
            MariWorkspaceBinding {
                entity,
                id,
                field: Some(field),
            },
        );
    }

    pub(crate) async fn tool_review_guard(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.tool_review_lock.lock().await
    }

    pub(crate) fn has_stream_events(&self) -> bool {
        self.trace_channel.is_some()
    }

    pub(crate) fn next_approval_id(&self, tool_name: &str) -> String {
        let sequence = self
            .approval_sequence
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            + 1;
        format!(
            "mari-approval-{}-{sequence}-{tool_name}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        )
    }

    pub(crate) fn send_stream_event(&self, event: Value) -> AppResult<()> {
        if let Some(channel) = &self.trace_channel {
            channel
                .send(event)
                .map_err(|error| AppError::new("mari_stream_event_failed", error.to_string()))?;
        }
        Ok(())
    }

    async fn read_directory_for_tool(
        &self,
        path: &str,
        offset: usize,
        limit: Option<usize>,
    ) -> AppResult<Value> {
        let index_path = Path::new(path).join("index.md");
        if self
            .fs
            .exists(&index_path)
            .await
            .map_err(|error| AppError::new("mari_read_failed", error.to_string()))?
            && self
                .fs
                .stat(&index_path)
                .await
                .map_err(|error| AppError::new("mari_read_failed", error.to_string()))?
                .file_type
                == FileType::File
        {
            return self
                .read_file_for_tool(
                    &index_path.to_string_lossy(),
                    "directory_index",
                    Some(path),
                    offset,
                    limit,
                )
                .await;
        }

        let mut entries = self
            .fs
            .read_dir(Path::new(path))
            .await
            .map_err(|error| AppError::new("mari_read_failed", error.to_string()))?;
        entries.sort_by(|a, b| {
            b.metadata
                .file_type
                .is_dir()
                .cmp(&a.metadata.file_type.is_dir())
                .then_with(|| {
                    a.name
                        .to_ascii_lowercase()
                        .cmp(&b.name.to_ascii_lowercase())
                })
        });
        let mut lines = vec![format!("Directory: {path}"), String::new()];
        if entries.is_empty() {
            lines.push("(empty directory)".to_string());
        } else {
            lines.extend(entries.into_iter().map(directory_entry_line));
        }
        let content = lines.join("\n");
        let (selected, total_lines) = select_lines(&content, offset, limit);
        Ok(json!({
            "path": path,
            "kind": "directory",
            "content": util::truncate_tool_text(&selected),
            "totalLines": total_lines,
            "note": "Path is a directory; returned a directory listing because no index.md file exists.",
        }))
    }

    async fn read_file_for_tool(
        &self,
        path: &str,
        kind: &str,
        directory_path: Option<&str>,
        offset: usize,
        limit: Option<usize>,
    ) -> AppResult<Value> {
        let bytes = self
            .fs
            .read_file(Path::new(path))
            .await
            .map_err(|error| AppError::new("mari_read_failed", error.to_string()))?;
        let content = String::from_utf8_lossy(&bytes);
        let (selected, total_lines) = select_lines(&content, offset, limit);
        let mut value = json!({
            "path": path,
            "kind": kind,
            "content": util::truncate_tool_text(&selected),
            "totalLines": total_lines,
        });
        if let Some(directory_path) = directory_path {
            value["directoryPath"] = json!(directory_path);
            value["note"] = json!("Path is a directory; returned its index.md file.");
        }
        Ok(value)
    }

    async fn snapshot_review_files(&self) -> AppResult<BTreeMap<String, Vec<u8>>> {
        let mut files = BTreeMap::new();
        collect_files_recursive(&self.fs, Path::new("/workspace"), &mut files).await?;
        Ok(files)
    }
}

const PROF_MARI_WORKSPACE_README: &str = "# Prof Mari virtual workspace\n\nThis is an isolated bash workspace populated from the user's Marinara creative library. Start at `/workspace/index.md`, then inspect folders such as `characters/`, `personas/`, `lorebooks/`, and `prompts/`. Paths are descriptive and duplicate-safe; Marinara tracks hidden storage IDs internally. When a tool changes files, Marinara pauses for user approval before that tool result is returned.\n\nThe `read` tool accepts files and directories. Reading a directory returns its `index.md` when present, otherwise an ls-style listing. For file layout requirements, read `/workspace/FORMAT.md` and the nearest folder-level `FORMAT.md`.\n";

fn directory_entry_line(entry: DirEntry) -> String {
    let suffix = match entry.metadata.file_type {
        FileType::Directory => "/",
        FileType::Symlink => "@",
        FileType::Fifo => "|",
        FileType::File => "",
    };
    let size = if entry.metadata.file_type == FileType::File {
        format!(", {} bytes", entry.metadata.size)
    } else {
        String::new()
    };
    format!(
        "- {}{} ({}){}",
        entry.name,
        suffix,
        file_type_label(entry.metadata.file_type),
        size
    )
}

fn file_type_label(file_type: FileType) -> &'static str {
    match file_type {
        FileType::File => "file",
        FileType::Directory => "directory",
        FileType::Symlink => "symlink",
        FileType::Fifo => "fifo",
    }
}

fn select_lines(content: &str, offset: usize, limit: Option<usize>) -> (String, usize) {
    let lines = content.lines().collect::<Vec<_>>();
    let selected = lines
        .iter()
        .skip(offset.saturating_sub(1))
        .take(limit.unwrap_or(usize::MAX))
        .copied()
        .collect::<Vec<_>>()
        .join("\n");
    (selected, lines.len())
}

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
        files.insert(
            util::normalize_virtual_path(&path.to_string_lossy()),
            content,
        );
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
