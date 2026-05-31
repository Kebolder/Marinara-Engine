import { beforeEach, describe, expect, it, vi } from "vitest";
import { storageApi } from "../../../../shared/api/storage-api";
import { trackerSnapshotApi } from "../../../../shared/api/tracker-snapshot-api";
import { worldStateApi } from "./world-state-api";

const storageApiMock = vi.hoisted(() => ({
  get: vi.fn(),
  listChatMessages: vi.fn(),
  update: vi.fn(),
}));

const trackerSnapshotApiMock = vi.hoisted(() => ({
  get: vi.fn(),
  latest: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: storageApiMock,
}));

vi.mock("../../../../shared/api/tracker-snapshot-api", () => ({
  trackerSnapshotApi: trackerSnapshotApiMock,
}));

describe("worldStateApi", () => {
  beforeEach(() => {
    vi.mocked(storageApi.get).mockReset();
    vi.mocked(storageApi.listChatMessages).mockReset();
    vi.mocked(storageApi.update).mockReset();
    vi.mocked(trackerSnapshotApi.get).mockReset();
    vi.mocked(trackerSnapshotApi.latest).mockReset();
    vi.mocked(trackerSnapshotApi.save).mockReset();
  });

  it("resolves the visible tracker target with projected message metadata only", async () => {
    vi.mocked(storageApi.get).mockResolvedValueOnce({ id: "chat-1", gameState: null });
    vi.mocked(storageApi.listChatMessages).mockResolvedValueOnce([
      { id: "user-1", role: "user", activeSwipeIndex: 0 },
      { id: "assistant-1", role: "assistant", activeSwipeIndex: 2 },
    ]);
    vi.mocked(trackerSnapshotApi.get).mockResolvedValueOnce({
      id: "state-1",
      kind: "tracker",
      chatId: "chat-1",
      messageId: "assistant-1",
      swipeIndex: 2,
      date: null,
      time: null,
      location: null,
      weather: null,
      temperature: null,
      presentCharacters: [],
      recentEvents: [],
      playerStats: null,
      personaStats: null,
      createdAt: "2026-05-30T00:00:00.000Z",
    });

    await expect(worldStateApi.get("chat-1")).resolves.toMatchObject({
      messageId: "assistant-1",
      swipeIndex: 2,
    });

    expect(storageApi.listChatMessages).toHaveBeenCalledWith("chat-1", {
      limit: 200,
      fields: ["id", "role", "activeSwipeIndex", "swipeIndex", "createdAt"],
    });
  });
});
