// ──────────────────────────────────────────────
// Shared gallery batch-upload runner
// Every gallery (chat, character, persona, global) uploads a batch of files the
// same way, so they share this runner to stay consistent. Each file uploads
// independently and successful rows are already persisted; the runner throws
// ONLY when every file failed (a true failure). On partial success it returns
// how many failed so the UI can warn honestly instead of reporting the whole
// batch as lost. Note: retrying still re-uploads the full set.
// ──────────────────────────────────────────────

export async function runGalleryUploadBatch<T>(
  files: File[],
  uploadOne: (file: File) => Promise<T>,
  allFailedMessage: (failedCount: number) => string,
): Promise<{ uploaded: T[]; failed: number }> {
  const results = await Promise.allSettled(files.map((file) => uploadOne(file)));
  const uploaded: T[] = [];
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") uploaded.push(result.value);
    else failures.push(result.reason);
  }
  if (uploaded.length === 0 && failures.length > 0) {
    // Surface the underlying error verbatim when a single file failed (e.g. a
    // size/type message); otherwise summarize the count.
    if (failures.length === 1 && failures[0] instanceof Error) throw failures[0];
    throw new Error(allFailedMessage(failures.length));
  }
  return { uploaded, failed: failures.length };
}
