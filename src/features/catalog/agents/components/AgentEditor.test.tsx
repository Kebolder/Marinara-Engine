// @vitest-environment jsdom

// Regression test for issue #1556 — the Agent editor header name input must
// carry the `min-w-0` Tailwind utility so the flex item can shrink and the
// Save / Delete buttons stay onscreen on narrow viewports. Without it the
// `flex-1` text input refuses to shrink below its content width and pushes the
// action buttons off the right edge on mobile.
//
// This mounts the REAL <AgentEditor /> against a real (seeded) zustand UI store
// and asserts the actual rendered header input className. Reverting the fix
// (removing `min-w-0` from the className string at the top of AgentEditor.tsx)
// makes the assertion fail (RED).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentEditor } from "./AgentEditor";
import { useUIStore } from "../../../../shared/stores/ui.store";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// React-query hooks the editor consumes. Returning empty data keeps the
// component on the built-in agent code path (no DB config row → uses the
// built-in meta for the name), which is the simplest path that still renders
// the real header input we care about.
// Every mocked hook returns STABLE references (frozen empties + a shared
// mutation stub defined inside each factory closure). Returning a fresh array /
// object identity on every render would change a useEffect/useMemo dependency
// each pass and drive the editor into an infinite re-render loop (OOMs the
// vitest worker). Stable identities keep the mount deterministic.
vi.mock("../hooks/use-agents", () => {
  const EMPTY: never[] = [];
  const noop = { mutateAsync: vi.fn(), isPending: false };
  return {
    agentKeys: {
      all: ["agents"],
      detail: (id: string) => ["agents", id],
      customRuns: (id: string) => ["agents", "runs", "custom", id],
    },
    useAgentConfigs: () => ({ data: EMPTY }),
    useUpdateAgent: () => noop,
    useCreateAgent: () => noop,
    useDeleteAgent: () => noop,
  };
});

vi.mock("../hooks/use-custom-tools", () => {
  const EMPTY: never[] = [];
  const EMPTY_OBJ = {};
  return {
    isCustomToolSelectable: () => false,
    useCustomTools: () => ({ data: EMPTY }),
    useCustomToolCapabilities: () => ({ data: EMPTY_OBJ }),
  };
});

vi.mock("../../connections/index", () => {
  const EMPTY: never[] = [];
  return {
    useConnections: () => ({ data: EMPTY }),
  };
});

vi.mock("../../lorebooks/index", () => {
  const EMPTY: never[] = [];
  const ENTRIES = { entries: EMPTY, isLoading: false, isError: false };
  return {
    useLorebooks: () => ({ data: EMPTY }),
    useEntriesAcrossLorebooks: () => ENTRIES,
  };
});

vi.mock("../../knowledge/index", () => {
  const EMPTY: never[] = [];
  const noop = { mutateAsync: vi.fn(), isPending: false };
  return {
    useKnowledgeSources: () => ({ data: EMPTY }),
    useUploadKnowledgeSource: () => noop,
    useDeleteKnowledgeSource: () => noop,
  };
});

vi.mock("../../../../shared/api/integration-utility-api", () => ({
  spotifyApi: {
    status: vi.fn(async () => ({ connected: false, expired: false, redirectUri: null })),
  },
}));

vi.mock("../../../../shared/lib/app-dialogs", () => ({
  showConfirmDialog: vi.fn(async () => false),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

describe("AgentEditor header name input (#1556)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Seed the real zustand store so the editor opens on a built-in agent.
    // "continuity" (Continuity Checker) is a plain post-processing writer agent
    // with no special UI branches, so it takes the simplest render path.
    useUIStore.setState({ agentDetailId: "continuity" });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
    useUIStore.setState({ agentDetailId: null, editorDirty: false });
    window.localStorage.clear();
  });

  it("renders the header name input with the min-w-0 shrink utility so action buttons stay onscreen", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentEditor />
        </QueryClientProvider>,
      );
    });

    // The header name input is the only text input with this placeholder.
    const nameInput = container.querySelector<HTMLInputElement>('input[placeholder="Agent name…"]');
    expect(nameInput).toBeTruthy();

    // Sanity: the built-in agent name populated, confirming we mounted the real
    // editor body (not the "Agent not found" fallback).
    expect(nameInput!.value).toBe("Continuity Checker");

    // The fix: this input must carry `min-w-0` alongside its existing flex-1
    // styling. Reverting the fix removes `min-w-0` → this assertion goes RED.
    const classes = nameInput!.className.split(/\s+/);
    expect(classes).toContain("min-w-0");
    expect(classes).toContain("flex-1");
  });
});
