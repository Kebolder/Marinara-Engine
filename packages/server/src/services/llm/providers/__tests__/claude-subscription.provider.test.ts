// Provider integration test — verifies the resume path wiring end-to-end.
//
// Uses `__setSdkForTesting` to inject a fake SDK that captures the `query()`
// arguments. The resume path now feeds prior history to the SDK through a
// `sessionStore` adapter rather than a JSONL file on disk, so the fake mimics
// what the real SDK does: when `options.sessionStore` + `options.resume` are
// present it calls `sessionStore.load()` and snapshots the returned entries.
//
// No filesystem, no `process.chdir`, no platform gating — the resume path is
// platform-agnostic now that the SDK owns transcript materialization.

import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";

import { ClaudeSubscriptionProvider, __setSdkForTesting } from "../claude-subscription.provider.ts";

interface CapturedQuery {
  prompt: unknown;
  options: Record<string, unknown>;
  /**
   * Entries returned by `options.sessionStore.load()` for `options.resume`,
   * captured inside the fake's generator — exactly what the real SDK would
   * materialize and resume from. `null` when the call had no resume wiring
   * (fold path / single-turn empty-history requests).
   */
  resumeEntries: Array<Record<string, unknown>> | null;
}

interface FakeSessionStore {
  load(key: { projectKey: string; sessionId: string }): Promise<unknown[] | null>;
}

function makeFakeSdk(captured: CapturedQuery[]): { query: (args: unknown) => AsyncIterable<unknown> } {
  return {
    query(args: unknown) {
      const { prompt, options } = args as { prompt: unknown; options: Record<string, unknown> };
      const entry: CapturedQuery = { prompt, options, resumeEntries: null };
      captured.push(entry);

      async function* iter(): AsyncIterable<unknown> {
        // Mirror the real SDK: when a sessionStore + resume id are wired, the
        // SDK calls load() once before subprocess spawn to materialize the
        // resume transcript. Snapshot it here so tests can inspect history.
        const store = options["sessionStore"] as FakeSessionStore | undefined;
        const resumeId = typeof options["resume"] === "string" ? (options["resume"] as string) : null;
        if (store && resumeId) {
          const loaded = await store.load({ projectKey: "test-project", sessionId: resumeId });
          entry.resumeEntries = (loaded as Array<Record<string, unknown>> | null) ?? null;
        }
        // Without a text delta the provider's empty-response guard throws
        // before any assertion runs. Emit a minimal one to keep it quiet.
        yield {
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } },
        };
        yield {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 10, output_tokens: 20 },
          modelUsage: { "claude-test-model": { input_tokens: 10, output_tokens: 20 } },
          fast_mode_state: "off",
        };
      }
      return iter();
    },
  };
}

async function collectIterable<T>(it: AsyncIterable<T> | Iterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it as AsyncIterable<T>) out.push(v);
  return out;
}

async function drainProviderChat(
  provider: ClaudeSubscriptionProvider,
  messages: Parameters<ClaudeSubscriptionProvider["chat"]>[0],
  options: Parameters<ClaudeSubscriptionProvider["chat"]>[1],
): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of provider.chat(messages, options)) {
    if (typeof chunk === "string") chunks.push(chunk);
  }
  return chunks;
}

function installFakeSdk(): CapturedQuery[] {
  const captured: CapturedQuery[] = [];
  // Fake `query` returns `AsyncIterable<unknown>` rather than the SDK's full
  // `Query` interface (with `close()` etc.). The provider only iterates, so
  // the runtime shape is sufficient; cast through `unknown` at the seam.
  __setSdkForTesting(makeFakeSdk(captured) as unknown as Parameters<typeof __setSdkForTesting>[0]);
  return captured;
}

// A connection-supplied `customParameters` payload that tries to smuggle the
// three reserved SDK keys. Shared by the two security tests below so they both
// attack with an identical forged payload. The forged `sessionStore` would
// inject an attacker-controlled transcript if customParameters were allowed
// to win; `uuid: "FORGED"` is the sentinel each test asserts never lands.
const FORGED_RESERVED_PARAMS = {
  resume: "attacker-forged-session-id",
  cwd: "/etc/passwd",
  sessionStore: { load: async () => [{ type: "user", uuid: "FORGED" }] },
};

describe("ClaudeSubscriptionProvider — resume path wiring", () => {
  afterEach(() => {
    __setSdkForTesting(null);
  });

  it("passes resume + cwd + sessionStore to the SDK for multi-turn history", async () => {
    const captured = installFakeSdk();

    const provider = new ClaudeSubscriptionProvider("", "");
    await drainProviderChat(
      provider,
      [
        { role: "user", content: "first user message" },
        { role: "assistant", content: "first assistant reply" },
        { role: "user", content: "second user message" },
      ],
      { model: "claude-test-model", stream: false },
    );

    assert.equal(captured.length, 1, "SDK query() should have been called exactly once");
    const call = captured[0]!;
    const resumeId = call.options["resume"];
    assert.equal(typeof resumeId, "string", "resume should be a string sessionId");
    assert.match(resumeId as string, /^[0-9a-f-]{36}$/, "resume should look like a UUID");
    assert.equal(typeof call.options["cwd"], "string", "cwd should be set alongside resume");
    assert.ok((call.options["cwd"] as string).length > 0, "cwd should be a non-empty path");
    assert.equal(typeof call.options["sessionStore"], "object", "sessionStore adapter should be wired");
    assert.ok(call.options["sessionStore"], "sessionStore should be non-null");

    // Prompt is an AsyncIterable<SDKUserMessage>; collect and inspect.
    const promptMessages = await collectIterable(call.prompt as AsyncIterable<unknown>);
    assert.equal(promptMessages.length, 1, "prompt iterable should yield exactly one SDKUserMessage");
    const userMsg = promptMessages[0] as { type: string; message: { role: string; content: unknown } };
    assert.equal(userMsg.type, "user");
    assert.equal(userMsg.message.role, "user");
    assert.equal(userMsg.message.content, "second user message", "current turn is the trailing user message");
  });

  it("feeds prior turns to the SDK via sessionStore.load()", async () => {
    const captured = installFakeSdk();

    const provider = new ClaudeSubscriptionProvider("", "");
    await drainProviderChat(
      provider,
      [
        { role: "user", content: "first user message" },
        { role: "assistant", content: "first assistant reply" },
        { role: "user", content: "second user message" },
      ],
      { model: "claude-test-model", stream: false },
    );

    const call = captured[0]!;
    assert.ok(call.resumeEntries, "sessionStore.load() should have returned entries");
    const entries = call.resumeEntries!;
    // History = all but the trailing user turn (which rides the prompt).
    assert.equal(entries.length, 2, "two prior turns go into the resume transcript");
    assert.equal(entries[0]!["type"], "user");
    assert.equal(entries[1]!["type"], "assistant");
    // parentUuid chain links the second entry to the first.
    assert.equal(entries[1]!["parentUuid"], entries[0]!["uuid"]);
  });

  it("emits image blocks on the current turn AND on historical user turns", async () => {
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const captured = installFakeSdk();

    const provider = new ClaudeSubscriptionProvider("", "");
    await drainProviderChat(
      provider,
      [
        { role: "user", content: "look at this", images: [dataUrl] },
        { role: "assistant", content: "I see it" },
        { role: "user", content: "and this one?", images: [dataUrl] },
      ],
      { model: "claude-test-model", stream: false },
    );

    const call = captured[0]!;

    // Current-turn images come through the prompt iterable.
    const promptMessages = await collectIterable(call.prompt as AsyncIterable<unknown>);
    const userMsg = promptMessages[0] as { message: { content: unknown } };
    const currentBlocks = userMsg.message.content as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(currentBlocks), "current turn with images must use block-array content");
    assert.equal(currentBlocks[0]!["type"], "image", "first block is the image");
    assert.deepEqual(currentBlocks[1], { type: "text", text: "and this one?" });

    // Historical-turn image must survive into the resume transcript.
    assert.ok(call.resumeEntries, "sessionStore.load() should have returned entries");
    const firstEntry = call.resumeEntries![0]! as { type: string; message: { content: unknown } };
    assert.equal(firstEntry.type, "user");
    assert.ok(Array.isArray(firstEntry.message.content), "historical user with images uses block-array content");
    const historicalBlocks = firstEntry.message.content as Array<Record<string, unknown>>;
    assert.equal(historicalBlocks[0]!["type"], "image", "historical image block survives the resume transcript");
  });

  it("keeps the trailing assistant prefill in history and sends a synthetic continuation prompt", async () => {
    const captured = installFakeSdk();

    const provider = new ClaudeSubscriptionProvider("", "");
    await drainProviderChat(
      provider,
      [
        { role: "user", content: "tell me a story" },
        { role: "assistant", content: "Once upon a time, there was" },
      ],
      { model: "claude-test-model", stream: false },
    );

    const call = captured[0]!;
    // The prefill assistant turn stays in the resume transcript.
    assert.ok(call.resumeEntries, "sessionStore.load() should have returned entries");
    const entries = call.resumeEntries!;
    assert.equal(entries[entries.length - 1]!["type"], "assistant", "prefill assistant stays in the transcript");

    // The prompt is a synthetic continuation: non-empty (the Anthropic API
    // rejects empty content) and clearly NOT the assistant's prefill text.
    const promptMessages = await collectIterable(call.prompt as AsyncIterable<unknown>);
    const userMsg = promptMessages[0] as { message: { role: string; content: unknown } };
    assert.equal(userMsg.message.role, "user");
    assert.equal(typeof userMsg.message.content, "string");
    assert.notEqual(userMsg.message.content, "Once upon a time, there was");
    assert.ok((userMsg.message.content as string).length > 0);
  });

  it("connection-level customParameters cannot override the reserved resume/cwd/sessionStore keys", async () => {
    const captured = installFakeSdk();

    const provider = new ClaudeSubscriptionProvider("", "");
    await drainProviderChat(
      provider,
      [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" },
      ],
      {
        model: "claude-test-model",
        stream: false,
        customParameters: FORGED_RESERVED_PARAMS,
      },
    );

    const call = captured[0]!;
    assert.notEqual(call.options["resume"], "attacker-forged-session-id", "resume must not be overridable");
    assert.notEqual(call.options["cwd"], "/etc/passwd", "cwd must not be overridable");
    assert.match(call.options["resume"] as string, /^[0-9a-f-]{36}$/);
    // The provider's real store won — load() returned the real history, not
    // the forged single entry.
    assert.ok(call.resumeEntries, "the provider's own sessionStore should have served load()");
    assert.ok(
      !call.resumeEntries!.some((e) => e["uuid"] === "FORGED"),
      "forged sessionStore must not reach the SDK",
    );
  });

  it("scrubs forged reserved keys on the single-turn path (resume never engages)", async () => {
    // The reserved-key scrub must run unconditionally, not only when the
    // resume path engages. A single-turn request has no prior history, so
    // resume stays disabled — but a connection's customParameters could still
    // smuggle a forged resume/cwd/sessionStore straight to the SDK if the
    // scrub were gated behind the resume guard. All three must be stripped
    // and never re-added here.
    const captured = installFakeSdk();

    const provider = new ClaudeSubscriptionProvider("", "");
    await drainProviderChat(
      provider,
      [{ role: "user", content: "single turn message" }],
      {
        model: "claude-test-model",
        stream: false,
        customParameters: FORGED_RESERVED_PARAMS,
      },
    );

    const call = captured[0]!;
    assert.equal(call.options["resume"], undefined, "forged resume must be scrubbed when resume doesn't engage");
    assert.equal(call.options["cwd"], undefined, "forged cwd must be scrubbed when resume doesn't engage");
    assert.equal(call.options["sessionStore"], undefined, "forged sessionStore must be scrubbed when resume doesn't engage");
    assert.equal(call.resumeEntries, null, "no transcript should be materialized — the forged store never reached the SDK");
  });

  it("skips the resume path entirely for single-turn requests (empty history)", async () => {
    // Resuming an empty transcript makes the SDK reject it ("No conversation
    // found"), so single-turn requests send `current` directly via the
    // AsyncIterable prompt with no resume wiring at all.
    const captured = installFakeSdk();

    const provider = new ClaudeSubscriptionProvider("", "");
    await drainProviderChat(
      provider,
      [{ role: "user", content: "single turn message" }],
      { model: "claude-test-model", stream: false },
    );

    const call = captured[0]!;
    assert.equal(call.options["resume"], undefined, "resume must NOT be set for single-turn requests");
    assert.equal(call.options["cwd"], undefined, "cwd must NOT be set when resume is absent");
    assert.equal(call.options["sessionStore"], undefined, "sessionStore must NOT be set when resume is absent");

    // The current message still flows via the AsyncIterable prompt so images
    // and multimodal content on the first turn still work.
    const promptMessages = await collectIterable(call.prompt as AsyncIterable<unknown>);
    assert.equal(promptMessages.length, 1);
    const userMsg = promptMessages[0] as { type: string; message: { content: unknown } };
    assert.equal(userMsg.type, "user");
    assert.equal(userMsg.message.content, "single turn message");
  });

  it("concurrent provider calls produce distinct session UUIDs and distinct stores", async () => {
    // Locks in the invariant: each chat() invocation mints a fresh UUID via
    // randomUUID() and its own ResumeSessionStore. There is no `chatId ->
    // sessionId` mapping that would let same-tick concurrent calls collide.
    const captured = installFakeSdk();

    const provider = new ClaudeSubscriptionProvider("", "");
    const baseHistory = [
      { role: "user" as const, content: "prior turn" },
      { role: "assistant" as const, content: "prior reply" },
    ];
    await Promise.all([
      drainProviderChat(
        provider,
        [...baseHistory, { role: "user", content: "concurrent A" }],
        { model: "claude-test-model", stream: false },
      ),
      drainProviderChat(
        provider,
        [...baseHistory, { role: "user", content: "concurrent B" }],
        { model: "claude-test-model", stream: false },
      ),
    ]);

    assert.equal(captured.length, 2, "both calls should have invoked the SDK");
    const resumeA = captured[0]!.options["resume"];
    const resumeB = captured[1]!.options["resume"];
    assert.equal(typeof resumeA, "string");
    assert.equal(typeof resumeB, "string");
    assert.notEqual(resumeA, resumeB, "concurrent calls must produce distinct resume sessionIds");
    assert.notEqual(
      captured[0]!.options["sessionStore"],
      captured[1]!.options["sessionStore"],
      "concurrent calls must each get their own sessionStore instance",
    );
  });

  it("assembles the same systemPrompt under CLAUDE_SUBSCRIPTION_USE_RESUME=true and =false", async () => {
    // Snapshot parity: toggling the kill switch must not change what the SDK
    // sees as `systemPrompt`.
    const messages: Parameters<ClaudeSubscriptionProvider["chat"]>[0] = [
      { role: "system", content: "you are mari" },
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
    ];

    // Snapshot the developer's shell env so we always leave it as we found it.
    const priorKill = process.env.CLAUDE_SUBSCRIPTION_USE_RESUME;
    const capturedResume: CapturedQuery[] = [];
    const capturedFold: CapturedQuery[] = [];
    try {
      // ── Resume path (env unset → default true) ──
      __setSdkForTesting(makeFakeSdk(capturedResume) as unknown as Parameters<typeof __setSdkForTesting>[0]);
      delete process.env.CLAUDE_SUBSCRIPTION_USE_RESUME;
      await drainProviderChat(new ClaudeSubscriptionProvider("", ""), messages, {
        model: "claude-test-model",
        stream: false,
      });

      // ── Fold path (env=false) ──
      __setSdkForTesting(makeFakeSdk(capturedFold) as unknown as Parameters<typeof __setSdkForTesting>[0]);
      process.env.CLAUDE_SUBSCRIPTION_USE_RESUME = "false";
      await drainProviderChat(new ClaudeSubscriptionProvider("", ""), messages, {
        model: "claude-test-model",
        stream: false,
      });
    } finally {
      if (priorKill === undefined) delete process.env.CLAUDE_SUBSCRIPTION_USE_RESUME;
      else process.env.CLAUDE_SUBSCRIPTION_USE_RESUME = priorKill;
    }

    assert.equal(capturedResume.length, 1);
    assert.equal(capturedFold.length, 1);
    const systemResume = capturedResume[0]!.options["systemPrompt"];
    const systemFold = capturedFold[0]!.options["systemPrompt"];
    assert.equal(typeof systemResume, "string");
    assert.equal(typeof systemFold, "string");
    assert.equal(systemResume, systemFold, "systemPrompt must match byte-for-byte between resume and fold paths");
    assert.equal(systemResume, "you are mari\n\nbe terse");
  });

  it("strips SDK auto-context: no claude_code preset, empty skills/settingSources, maxTurns=1", async () => {
    const captured = installFakeSdk();

    const provider = new ClaudeSubscriptionProvider("", "");
    await drainProviderChat(
      provider,
      [
        { role: "system", content: "be Mari" },
        { role: "user", content: "hello" },
      ],
      { model: "claude-test-model", stream: false },
    );

    const opts = captured[0]!.options;
    assert.equal(typeof opts["systemPrompt"], "string", "systemPrompt must be a plain string, not a preset object");
    assert.deepEqual(opts["skills"], [], "skills must be explicitly empty");
    assert.deepEqual(opts["settingSources"], [], "settingSources must be explicitly empty so CLAUDE.md doesn't auto-load");
    assert.equal(opts["maxTurns"], 1, "maxTurns must be 1 — Marinara drives multi-turn at the route layer");
    assert.equal(opts["allowDangerouslySkipPermissions"], true, "explicit bypass to skip permission framing");
    assert.equal(opts["permissionMode"], "bypassPermissions");
    assert.deepEqual(opts["tools"], []);
  });
});

describe("ClaudeSubscriptionProvider — resume path is platform-agnostic", () => {
  // The resume path no longer has any platform branch: the SDK owns
  // transcript materialization, so there is no cwd→project-dir path math for
  // Windows to break. Forcing win32 must NOT divert to the fold path — this
  // is the inverse of the old win32 fold-path fallback test, and pins that
  // the platform gate is gone for good.
  // Snapshot at describe-eval time — before any hook mutates `process.platform`
  // — so `afterEach` always has a real platform to restore, even if the test
  // throws before the override below is in place.
  const priorPlatform: NodeJS.Platform = process.platform;
  afterEach(() => {
    __setSdkForTesting(null);
    if (process.platform !== priorPlatform) {
      Object.defineProperty(process, "platform", { value: priorPlatform, configurable: true });
    }
  });

  it("engages the resume path on win32 (no platform gate)", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    const captured = installFakeSdk();

    const provider = new ClaudeSubscriptionProvider("", "");
    await drainProviderChat(
      provider,
      [
        { role: "user", content: "first user message" },
        { role: "assistant", content: "first assistant reply" },
        { role: "user", content: "second user message" },
      ],
      { model: "claude-test-model", stream: false },
    );

    const call = captured[0]!;
    assert.match(call.options["resume"] as string, /^[0-9a-f-]{36}$/, "resume must engage on win32 too");
    assert.equal(typeof call.options["sessionStore"], "object", "sessionStore must be wired on win32 too");
    assert.notEqual(typeof call.prompt, "string", "win32 must use the AsyncIterable resume prompt, not a folded string");
  });
});
