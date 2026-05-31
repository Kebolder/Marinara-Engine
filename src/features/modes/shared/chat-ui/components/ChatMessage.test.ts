import { describe, expect, it } from "vitest";
import type { Message } from "../../../../../engine/contracts/types/chat";
import {
  formatEditableMessageText,
  formatGenerationLabelForMessage,
  sanitizeChatCss,
  sanitizeChatStyleDeclarations,
} from "./ChatMessage";

describe("ChatMessage style sanitization", () => {
  it("removes viewport-breaking inline style declarations", () => {
    const style = sanitizeChatStyleDeclarations(
      "color: red; position: fixed; inset: 0; z-index: 999999; width: 100vw; height: 99999px; font-weight: 700 !important",
    );

    expect(style).toContain("color: red");
    expect(style).toContain("font-weight: 700");
    expect(style).not.toContain("position");
    expect(style).not.toContain("inset");
    expect(style).not.toContain("z-index");
    expect(style).not.toContain("width");
    expect(style).not.toContain("height");
    expect(style).not.toContain("important");
  });

  it("scopes style blocks after removing layout escape hatches", () => {
    const css = sanitizeChatCss(
      "body{position:fixed!important;inset:0;width:100vw;color:red}.card{transform:translateY(-100vh);padding:1rem}",
    );

    expect(css).toContain("color: red");
    expect(css).toContain("padding: 1rem");
    expect(css).not.toContain("position");
    expect(css).not.toContain("inset");
    expect(css).not.toContain("width");
    expect(css).not.toContain("transform");
    expect(css).not.toContain("important");
  });
});

describe("ChatMessage edit quote formatting", () => {
  it("uses the selected quote style for edited message text", () => {
    expect(formatEditableMessageText('"Hello," it\'s me.', "typographic")).toBe("\u201cHello,\u201d it\u2019s me.");
    expect(formatEditableMessageText("\u201cHello,\u201d it\u2019s me.", "straight")).toBe('"Hello," it\'s me.');
  });

  it("leaves protected code spans alone while formatting edited text", () => {
    expect(formatEditableMessageText('She said "yes" and typed `const x = "no"`.', "typographic")).toBe(
      'She said \u201cyes\u201d and typed `const x = "no"`.',
    );
  });
});

describe("ChatMessage generation labels", () => {
  it("uses saved prompt snapshot generation metadata for generated messages", () => {
    const message = {
      role: "assistant",
      extra: {
        generationPromptSnapshot: {
          generationInfo: {
            model: "gpt-5",
            tokensPrompt: 120,
            tokensCompletion: 30,
            tokensCachedPrompt: 50,
            durationMs: 1320,
          },
        },
      },
    } as unknown as Message;

    expect(formatGenerationLabelForMessage(message, true, false)).toBe("gpt-5");
    expect(formatGenerationLabelForMessage(message, true, true)).toBe(
      "gpt-5 \u00b7 120\u219230 tok \u00b7 cache hit 50 \u00b7 1.3s",
    );
  });

  it("falls back to top-level generation metadata saved by message creation", () => {
    const message = {
      role: "assistant",
      generationInfo: {
        model: "claude-sonnet-4-5",
        usage: {
          promptTokens: 80,
          completionTokens: 20,
        },
      },
    } as unknown as Message;

    expect(formatGenerationLabelForMessage(message, true, true)).toBe("claude-sonnet-4-5 \u00b7 80\u219220 tok");
  });
});
