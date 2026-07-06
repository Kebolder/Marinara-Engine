import { formatTextQuotes, type QuoteFormat } from "@marinara-engine/shared";
import { captureTextSelection, restoreTextSelectionAfterRender } from "./text-selection";

const pendingSelectionRestores = new WeakMap<HTMLTextAreaElement, () => void>();

export function applyTextareaQuoteFormat(textarea: HTMLTextAreaElement, quoteFormat: QuoteFormat): string {
  pendingSelectionRestores.get(textarea)?.();
  pendingSelectionRestores.delete(textarea);

  const raw = textarea.value;
  const formatted = formatTextQuotes(raw, quoteFormat);
  if (raw === formatted) return formatted;

  const selection = captureTextSelection(textarea);
  textarea.value = formatted;
  if (selection) {
    pendingSelectionRestores.set(textarea, restoreTextSelectionAfterRender(selection));
  }
  return formatted;
}
