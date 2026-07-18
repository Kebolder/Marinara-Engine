import type { WrapFormat } from "@marinara-engine/shared";

// Some import paths can hand us the standard example-dialogue separator after
// an HTML-entity pass. Only this exact control marker is canonicalized.
const EXAMPLE_DIALOGUE_MARKER_PATTERN = /(<START>|&lt;START(?:&gt;|>))/g;
const EXACT_EXAMPLE_DIALOGUE_MARKER_PATTERN = /^(?:<START>|&lt;START(?:&gt;|>))$/;

export function escapeXmlText(value: string): string {
  // XML text nodes only require escaping `&` and `<`. Keep plain `>` literal so
  // user-authored Markdown blockquotes do not become visible `&gt;` tokens.
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function neutralizeMarkdownHeadings(value: string): string {
  return value.replace(/^(\s{0,3})(#{1,6})(?=\s|$)/gm, "$1\\$2");
}

export function sanitizePromptLeaf(value: string, wrapFormat: WrapFormat): string {
  if (wrapFormat === "xml") return escapeXmlText(value);
  if (wrapFormat === "markdown") return neutralizeMarkdownHeadings(value);
  return value;
}

export function sanitizeExampleDialoguePromptLeaf(value: string, wrapFormat: WrapFormat): string {
  if (wrapFormat !== "xml") return sanitizePromptLeaf(value, wrapFormat);

  return value
    .split(EXAMPLE_DIALOGUE_MARKER_PATTERN)
    .map((chunk) => (EXACT_EXAMPLE_DIALOGUE_MARKER_PATTERN.test(chunk) ? "<START>" : escapeXmlText(chunk)))
    .join("");
}
