// @vitest-environment jsdom

// Regression test for the user-facing half of #1555: an enabled regex script
// stored with a real boolean `enabled: true` must actually transform text on
// the live apply path (useApplyRegex -> ChatInput on send, ChatMessage on
// display). Pre-fix parseScript read `enabled === "true"` only, so a boolean
// row computed enabledBool=false and the script was silently skipped.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApplyRegex } from "./regex-application";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./hooks/use-regex-scripts", () => {
  // enabled / promptOnly are real booleans, matching the storage shape.
  const script = {
    id: "rx1",
    name: "FooBar",
    enabled: true,
    promptOnly: false,
    findRegex: "foo",
    replaceString: "bar",
    trimStrings: [],
    placement: ["ai_output", "user_input"],
    flags: "g",
    order: 0,
    minDepth: null,
    maxDepth: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  return { useRegexScripts: () => ({ data: [script] }) };
});

function Probe() {
  const { applyToAIOutput, applyToUserInput } = useApplyRegex();
  return (
    <div>
      <span data-testid="ai">{applyToAIOutput("foo baz")}</span>
      <span data-testid="user">{applyToUserInput("foo baz")}</span>
    </div>
  );
}

describe("useApplyRegex applies enabled boolean scripts (#1555)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("transforms ai_output and user_input text when enabled is a real boolean true", async () => {
    await act(async () => {
      root.render(<Probe />);
    });
    // GREEN post-fix: the boolean-true script applies; pre-fix it was skipped
    // (enabledBool=false) and the text passed through unchanged ("foo baz").
    expect(container.querySelector('[data-testid="ai"]')?.textContent).toBe("bar baz");
    expect(container.querySelector('[data-testid="user"]')?.textContent).toBe("bar baz");
  });
});
