export type CustomParametersParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

function quoteBareObjectValues(source: string): string {
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character !== ":") continue;

    let valueStart = index + 1;
    while (/\s/u.test(source[valueStart] ?? "")) valueStart += 1;
    const first = source[valueStart];
    if (!first || first === '"' || first === "{" || first === "[") continue;

    let valueEnd = valueStart;
    while (valueEnd < source.length && source[valueEnd] !== "," && source[valueEnd] !== "}") valueEnd += 1;
    let trimmedEnd = valueEnd;
    while (trimmedEnd > valueStart && /\s/u.test(source[trimmedEnd - 1] ?? "")) trimmedEnd -= 1;
    const rawValue = source.slice(valueStart, trimmedEnd);
    if (!rawValue) continue;

    try {
      JSON.parse(rawValue);
    } catch {
      replacements.push({ start: valueStart, end: trimmedEnd, value: JSON.stringify(rawValue) });
      index = valueEnd - 1;
    }
  }

  let normalized = source;
  for (const replacement of replacements.reverse()) {
    normalized = `${normalized.slice(0, replacement.start)}${replacement.value}${normalized.slice(replacement.end)}`;
  }
  return normalized;
}

export function parseCustomParametersDraft(draft: string): CustomParametersParseResult {
  const trimmed = draft.trim();
  if (!trimmed) return { ok: true, value: {} };

  const pythonLiteralNormalized = trimmed
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
  const attempts = Array.from(
    new Set([
      trimmed,
      quoteBareObjectValues(trimmed),
      pythonLiteralNormalized,
      quoteBareObjectValues(pythonLiteralNormalized),
    ]),
  );

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ok: true, value: parsed as Record<string, unknown> };
      }
      return { ok: false, error: "Custom parameters must be a JSON object, not an array or scalar." };
    } catch {
      // Try the next conservative normalization.
    }
  }

  return { ok: false, error: "Invalid object. Check property quotes, commas, and nested JSON values." };
}
