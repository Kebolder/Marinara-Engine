import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameNpc } from "../../../../engine/contracts/types/game";
import { BUILT_IN_MARI_AVATAR } from "../../../../engine/modes/game/assets/npc-avatar-utils";
import { useGameModeStore } from "./game-mode.store";

vi.mock("../api/game-api", () => ({
  gameApi: {
    updateWidgets: vi.fn(),
  },
}));

function npc(overrides: Partial<GameNpc>): GameNpc {
  return {
    id: overrides.id ?? "npc-1",
    emoji: overrides.emoji ?? "",
    name: overrides.name ?? "NPC",
    description: overrides.description ?? "",
    location: overrides.location ?? "",
    reputation: overrides.reputation ?? 0,
    met: overrides.met ?? true,
    notes: overrides.notes ?? [],
    avatarUrl: overrides.avatarUrl ?? null,
  };
}

describe("useGameModeStore NPC avatar handling", () => {
  afterEach(() => {
    useGameModeStore.getState().reset();
  });

  it("removes the built-in Mari avatar from non-Mari NPCs when syncing metadata", () => {
    useGameModeStore
      .getState()
      .setNpcs([
        npc({ id: "npc-caretaker", name: "Caretaker", avatarUrl: BUILT_IN_MARI_AVATAR }),
        npc({ id: "npc-mari", name: "Professor Mari", avatarUrl: BUILT_IN_MARI_AVATAR }),
      ]);

    const npcs = useGameModeStore.getState().npcs;
    expect(npcs.find((entry) => entry.id === "npc-caretaker")?.avatarUrl).toBeUndefined();
    expect(npcs.find((entry) => entry.id === "npc-mari")?.avatarUrl).toBe(BUILT_IN_MARI_AVATAR);
  });

  it("does not preserve a stale Mari avatar onto a non-Mari NPC from existing state", () => {
    useGameModeStore.getState().patchNpcAvatars([{ name: "Caretaker", avatarUrl: BUILT_IN_MARI_AVATAR }]);
    useGameModeStore.getState().setNpcs([npc({ id: "npc-caretaker", name: "Caretaker", avatarUrl: null })]);

    const [storedNpc] = useGameModeStore.getState().npcs;
    expect(storedNpc).toEqual(
      expect.objectContaining({
        id: "npc-caretaker",
        name: "Caretaker",
        avatarUrl: null,
      }),
    );
    expect(storedNpc?.avatarUrl).not.toBe(BUILT_IN_MARI_AVATAR);
  });

  it("scrubs a stale Mari avatar when patching the same generated URL", () => {
    useGameModeStore.setState({
      npcs: [npc({ id: "npc-caretaker", name: "Caretaker", avatarUrl: BUILT_IN_MARI_AVATAR })],
    });

    useGameModeStore.getState().patchNpcAvatars([{ name: "Caretaker", avatarUrl: BUILT_IN_MARI_AVATAR }]);

    const [storedNpc] = useGameModeStore.getState().npcs;
    expect(storedNpc?.avatarUrl).toBeUndefined();
  });
});
