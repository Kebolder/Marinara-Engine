import type { LLMToolCall, LLMToolDefinition } from "./base-provider.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toolCallId(index: number): string {
  return `text_tool_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  return parseJsonishObject(value) ?? {};
}

function parseJsonishObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidates = [
    trimmed,
    trimmed
      .replace(/([{,]\s*)([A-Za-z_][\w.-]*)\s*:/g, '$1"$2":')
      .replace(/:\s*'([^']*)'/g, (_, inner: string) => `: ${JSON.stringify(inner)}`),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return isRecord(parsed) ? parsed : null;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/**
 * Gemma 4 uses <|"|>string value<|"|> as a string delimiter instead of "string value".
 * Normalize these to standard double-quoted strings so JSON parsing can succeed.
 */
function normalizeGemma4Delimiters(content: string): string {
  return content.replace(/<\|"\|>(.*?)<\|"\|>/gs, (_, inner: string) => JSON.stringify(inner));
}

function parseJsonishObjectWithGemmaDelimiters(value: string): Record<string, unknown> | null {
  return parseJsonishObject(value) ?? (value.includes('<|"|>') ? parseJsonishObject(normalizeGemma4Delimiters(value)) : null);
}

function rawToolCalls(payload: Record<string, unknown>): unknown[] {
  const plural = payload.tool_calls ?? payload.toolCalls ?? payload.calls;
  if (Array.isArray(plural)) return plural;
  const single = payload.tool_call ?? payload.toolCall;
  if (single) return [single];
  if (typeof payload.name === "string" || typeof payload.tool === "string" || typeof payload.command === "string") {
    return [payload];
  }
  // Handle {"type": "function", "function": {"name": "...", ...}} OpenAI-style wrapper
  if (isRecord(payload.function) && typeof (payload.function as Record<string, unknown>).name === "string") {
    return [payload];
  }
  return [];
}

type ParsedTaggedSnippet = {
  text: string;
  allowCommandFallback: boolean;
  allowAnonymousJsonPayload: boolean;
};

function parseTaggedSnippets(content: string): ParsedTaggedSnippet[] {
  const snippets: ParsedTaggedSnippet[] = [];
  const patterns: Array<{ re: RegExp; allowCommandFallback: boolean; allowAnonymousJsonPayload: boolean }> = [
    {
      re: /<\|tool_call\|?>([\s\S]*?)(?:<tool_call\|>|<\|\/tool_call\|>|<\/tool_call>|$)/gi,
      allowCommandFallback: true,
      allowAnonymousJsonPayload: true,
    },
    {
      re: /<tool_call>([\s\S]*?)(?:<\/tool_call>|<\/arg_value>|$)/gi,
      allowCommandFallback: true,
      allowAnonymousJsonPayload: true,
    },
    { re: /<tool_code>([\s\S]*?)<\/tool_code>/gi, allowCommandFallback: true, allowAnonymousJsonPayload: true },
    { re: /```(?:json)?\s*([\s\S]*?)\s*```/gi, allowCommandFallback: false, allowAnonymousJsonPayload: false },
    // Meta Llama 3.1+ uses <|python_tag|> to delimit tool calls in content
    {
      re: /<\|python_tag\|>([\s\S]*?)(?:<\|eom_id\|>|<\|eot_id\|>|<\|end_header_id\|>|$)/gi,
      allowCommandFallback: false,
      allowAnonymousJsonPayload: false,
    },
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern.re)) {
      const snippet = match[1]?.trim();
      if (snippet) {
        snippets.push({
          text: snippet,
          allowCommandFallback: pattern.allowCommandFallback,
          allowAnonymousJsonPayload: pattern.allowAnonymousJsonPayload,
        });
      }
    }
  }
  const trimmed = content.trim();
  if (/^(?:call\s*:\s*)?[A-Za-z_][\w.-]*\s*\{[\s\S]*\}$/.test(trimmed)) {
    snippets.push({ text: trimmed, allowCommandFallback: false, allowAnonymousJsonPayload: false });
  }
  return snippets;
}

function snippetToPayload(snippet: string, options: Omit<ParsedTaggedSnippet, "text">): Record<string, unknown> | null {
  const jsonPayload = parseJsonishObject(snippet);
  if (jsonPayload) {
    if (typeof jsonPayload.name === "string" || typeof jsonPayload.tool === "string") return jsonPayload;
    // Pass through {"type":"function","function":{...}} wrappers to toolCallFromRaw
    if (isRecord(jsonPayload.function) && typeof (jsonPayload.function as Record<string, unknown>).name === "string") {
      return jsonPayload;
    }
    return options.allowAnonymousJsonPayload ? { name: "mari_db", arguments: jsonPayload } : null;
  }
  const callMatch = snippet.trim().match(/^(?:call\s*:\s*)?([A-Za-z_][\w.-]*)\s*(\{[\s\S]*\})\s*$/);
  if (!callMatch) {
    if (!options.allowCommandFallback) return null;
    const command = normalizeMariCommand(snippet);
    return command ? { name: "mari_db", arguments: { command } } : null;
  }
  const name = callMatch[1];
  const argsText = callMatch[2];
  if (!name || !argsText) return null;
  return {
    name,
    arguments: parseJsonishObject(argsText) ?? {},
  };
}

function normalizeMariCommand(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const command = raw.replace(/^\$+\s*/, "");
  if (command.length > 800 || /[\r\n]/.test(command) || /[;&|`$<>]/.test(command)) return null;
  if (/^mari(?:\s|$)/i.test(command)) return command;
  if (/^[A-Za-z][\w-]*(?:\s+[A-Za-z0-9_.:-]+)*$/.test(command)) return `mari ${command}`;
  return null;
}

function toolCallFromRaw(
  raw: unknown,
  index: number,
  knownTools: Set<string>,
  hasBashTool: boolean,
): LLMToolCall | null {
  if (!isRecord(raw)) return null;
  // Handle {"type":"function","function":{"name":"...","arguments":"..."}} OpenAI-style wrapper
  const fnWrap = isRecord(raw.function) ? (raw.function as Record<string, unknown>) : null;
  const nameValue = raw.name ?? raw.tool ?? fnWrap?.name;
  if (typeof nameValue !== "string") return null;
  const name = nameValue.trim();
  // "parameters" is used by many models (e.g. Llama 3.1, Gemma) instead of "arguments"
  const args = normalizeArguments(
    raw.arguments ?? raw.args ?? raw.input ?? raw.parameters ??
    fnWrap?.arguments ?? fnWrap?.args ?? fnWrap?.parameters ?? {},
  );
  if (knownTools.has(name)) {
    return {
      id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : toolCallId(index),
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    };
  }

  const normalizedName = name.toLowerCase().replace(/[-.]/g, "_");
  if (!hasBashTool || !["mari", "mari_cli", "mari_command", "mari_db"].includes(normalizedName)) return null;
  const command = normalizeMariCommand(args.command ?? args.cmd ?? args.query ?? args.input ?? args.text ?? raw.command);
  return command
    ? {
        id: toolCallId(index),
        type: "function",
        function: { name: "bash", arguments: JSON.stringify({ command }) },
      }
    : null;
}

export function parseTextualToolCalls(content: string | null | undefined, tools: LLMToolDefinition[] = []): LLMToolCall[] {
  if (!content || tools.length === 0) return [];

  const knownTools = new Set(tools.map((tool) => tool.function.name));
  const hasBashTool = knownTools.has("bash");
  const calls: LLMToolCall[] = [];

  // Try the whole content as a single JSON object
  const wholePayload = parseJsonishObjectWithGemmaDelimiters(content);
  if (wholePayload) {
    rawToolCalls(wholePayload).forEach((raw, index) => {
      const call = toolCallFromRaw(raw, index, knownTools, hasBashTool);
      if (call) calls.push(call);
    });
  }
  if (calls.length > 0) return calls;

  // Try the whole content as a top-level JSON array of tool calls
  const trimmed = content.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed.includes('<|"|>') ? normalizeGemma4Delimiters(trimmed) : trimmed);
      if (Array.isArray(arr)) {
        arr.forEach((raw, index) => {
          const call = toolCallFromRaw(raw, index, knownTools, hasBashTool);
          if (call) calls.push(call);
        });
      }
    } catch {
      /* not a valid JSON array */
    }
    if (calls.length > 0) return calls;
  }

  parseTaggedSnippets(content).forEach((snippet, index) => {
    const snippetText = snippet.text.includes('<|"|>') ? normalizeGemma4Delimiters(snippet.text) : snippet.text;
    const payload = snippetToPayload(snippetText, {
      allowCommandFallback: snippet.allowCommandFallback,
      allowAnonymousJsonPayload: snippet.allowAnonymousJsonPayload,
    });
    const call = toolCallFromRaw(payload, index, knownTools, hasBashTool);
    if (call) calls.push(call);
  });
  return calls;
}
