// Unit tests for the in-process SessionStore adapter that backs the resume
// path. The store exists so the Claude Agent SDK can load Marinara's
// synthetic history via `sessionStore.load()` without Marinara having to
// write — or path-encode — anything on the filesystem.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { ResumeSessionStore } from "../session-store.ts";
import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

const ENTRIES: SessionStoreEntry[] = [
  { type: "user", uuid: "u1" },
  { type: "assistant", uuid: "a1" },
];

describe("ResumeSessionStore", () => {
  it("load() returns the entries when the sessionId matches", async () => {
    const store = new ResumeSessionStore("sess-1", ENTRIES);
    const loaded = await store.load({ projectKey: "ignored", sessionId: "sess-1" });
    assert.deepEqual(loaded, ENTRIES);
  });

  it("load() ignores projectKey entirely — it matches on sessionId alone", async () => {
    // This is the property that frees the provider from replicating the SDK's
    // private cwd→projectKey encoding (the bug the old filesystem approach hit
    // on Windows). Whatever projectKey the SDK derives, load() still resolves.
    const store = new ResumeSessionStore("sess-1", ENTRIES);
    const a = await store.load({ projectKey: "anything", sessionId: "sess-1" });
    const b = await store.load({ projectKey: "C--totally--different", sessionId: "sess-1" });
    assert.deepEqual(a, ENTRIES);
    assert.deepEqual(b, ENTRIES);
  });

  it("load() returns null for an unknown sessionId", async () => {
    const store = new ResumeSessionStore("sess-1", ENTRIES);
    const loaded = await store.load({ projectKey: "x", sessionId: "some-other-session" });
    assert.equal(loaded, null);
  });

  it("append() is a no-op that resolves without mutating stored state", async () => {
    const store = new ResumeSessionStore("sess-1", ENTRIES);
    await store.append({ projectKey: "x", sessionId: "sess-1" }, [{ type: "user", uuid: "new" }]);
    // Marinara persists chat history in its own DB; the SDK's transcript
    // mirror is intentionally discarded. load() still returns the originals.
    const loaded = await store.load({ projectKey: "x", sessionId: "sess-1" });
    assert.deepEqual(loaded, ENTRIES);
  });
});
