import { expect, test } from "@playwright/test";

const generatedDefinition = {
  schemaVersion: 1,
  ownerMode: "roleplay",
  enabled: false,
  revision: 0,
  startingLocationId: "ai_world",
  locations: [
    {
      id: "ai_world",
      parentId: null,
      name: "Shrouded Coast",
      kind: "region",
      description: "A coast hidden beneath sea fog.",
      modelMemory: "Old shipping routes conceal forgotten coves.",
      icon: "🌫️",
      childPresentation: "map",
      links: [],
      status: "active",
      sortOrder: 0,
    },
    {
      id: "ai_harbor",
      parentId: "ai_world",
      name: "Gloam Harbor",
      kind: "settlement",
      description: "A busy harbor of black piers.",
      modelMemory: "The harbor master keeps a smuggling ledger.",
      icon: "⚓",
      childPresentation: "list",
      placement: { x: 25, y: 60 },
      links: [],
      status: "active",
      sortOrder: 0,
    },
    {
      id: "ai_lighthouse",
      parentId: "ai_world",
      name: "Blackglass Lighthouse",
      kind: "building",
      description: "A dark lighthouse on the cliffs.",
      modelMemory: "Its lamp reveals hidden ink at midnight.",
      icon: "🗼",
      childPresentation: "list",
      placement: { x: 72, y: 25 },
      links: [
        {
          targetId: "ai_sewers",
          label: "Smuggler tunnel",
          bidirectional: true,
          state: "hidden",
        },
      ],
      status: "active",
      sortOrder: 1,
    },
    {
      id: "ai_sewers",
      parentId: "ai_world",
      name: "Old Sewers",
      kind: "place",
      description: "Flooded tunnels beneath the coast.",
      modelMemory: "A sealed gate leads under the lighthouse.",
      icon: "🕳️",
      childPresentation: "list",
      placement: { x: 55, y: 82 },
      links: [],
      status: "active",
      sortOrder: 2,
    },
  ],
} as const;

const expandedDefinition = {
  ...generatedDefinition,
  enabled: true,
  revision: 1,
  locations: [
    ...generatedDefinition.locations,
    {
      id: "ai_riverside",
      parentId: "ai_world",
      name: "Riverside Ward",
      kind: "place",
      description: "A lantern-lit district beside the tidal river.",
      modelMemory: "The ward ferrymen know which tunnels remain dry.",
      icon: "🏮",
      childPresentation: "list",
      placement: { x: 82, y: 58 },
      links: [],
      status: "active",
      sortOrder: 3,
    },
    {
      id: "ai_minnow",
      parentId: "ai_riverside",
      name: "Silver Minnow Inn",
      kind: "building",
      description: "A crowded inn for ferrymen and river traders.",
      modelMemory: "A hidden cellar door opens at low tide.",
      icon: "🍺",
      childPresentation: "list",
      links: [],
      status: "active",
      sortOrder: 0,
    },
  ],
} as const;

test("AI map builder previews a validated local draft before save", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const response = await page.request.post("/api/chats", {
    data: {
      name: "AI Map Builder Smoke",
      mode: "roleplay",
      characterIds: [],
    },
  });
  expect(response.ok()).toBeTruthy();
  const chat = (await response.json()) as { id: string };
  const mobile = testInfo.project.name.includes("mobile");

  await page.route(`**/api/chats/${chat.id}/spatial-context/generate`, async (route) => {
    const request = route.request().postDataJSON() as {
      operation: string;
      size: string;
      instructions?: string;
      debugMode: boolean;
    };
    expect(request).toMatchObject({
      operation: "create",
      size: "small",
      instructions: "A foggy port with a lighthouse and secret sewers.",
      debugMode: false,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        operation: "create",
        size: "small",
        source: "roleplay_setup",
        generatedLocationCount: generatedDefinition.locations.length,
        definition: generatedDefinition,
      }),
    });
  });

  try {
    await page.addInitScript(
      ({ chatId, openEditor }) => {
        localStorage.setItem("marinara-active-chat-id", chatId);
        if (!openEditor) return;
        localStorage.setItem(
          "marinara-engine-ui",
          JSON.stringify({
            state: {
              hasCompletedOnboarding: true,
              rightPanelOpen: false,
              sidebarOpen: false,
              spatialMapDetailChatId: chatId,
            },
            version: 72,
          }),
        );
      },
      { chatId: chat.id, openEditor: mobile },
    );
    await page.route("**/api/backgrounds/file/Black.jpg", async (route) => {
      await route.fulfill({ status: 204, body: "" });
    });
    await page.goto("/");

    if (!mobile) {
      await page.getByRole("button", { name: "Chat Settings" }).click();
      const drawer = page.locator(".mari-chat-settings-drawer");
      await drawer.getByText("Hierarchical map", { exact: true }).click();
      await drawer.getByRole("button", { name: "Create hierarchical map" }).click();
    }

    await page.getByRole("button", { name: "Draft with AI" }).click();
    await expect(page.getByRole("heading", { name: "Draft the map with AI" })).toBeVisible();
    await page.getByLabel("What should this world include?").fill("A foggy port with a lighthouse and secret sewers.");
    await page.getByRole("button", { name: /Small About 8 places/ }).click();
    await page.getByRole("button", { name: "Generate draft" }).click();
    await expect(page.getByText("Validated", { exact: true })).toBeVisible();
    await expect(page.getByText("4 new locations", { exact: true })).toBeVisible();
    await expect(page.getByText("Shrouded Coast", { exact: true })).toBeVisible();

    const beforeApply = await page.request.get(`/api/chats/${chat.id}/spatial-context`);
    expect(((await beforeApply.json()) as { definition: unknown }).definition).toBeNull();

    await page.getByRole("button", { name: "Use this draft" }).click();
    await expect(page.getByText("AI map draft applied. Review it, then Save.")).toBeVisible();
    const hierarchy = page.locator('section[aria-label="Location hierarchy"]:visible');
    await expect(hierarchy.getByRole("button", { name: "Shrouded Coast region" })).toBeVisible();

    const afterApply = await page.request.get(`/api/chats/${chat.id}/spatial-context`);
    expect(((await afterApply.json()) as { definition: unknown }).definition).toBeNull();

    await page.getByLabel("Disabled", { exact: true }).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    const storedResponse = await page.request.get(`/api/chats/${chat.id}/spatial-context`);
    const stored = (await storedResponse.json()) as {
      definition: { enabled: boolean; locations: Array<{ name: string }> };
    };
    expect(stored.definition.enabled).toBe(true);
    expect(stored.definition.locations.map((location) => location.name)).toEqual([
      "Shrouded Coast",
      "Gloam Harbor",
      "Blackglass Lighthouse",
      "Old Sewers",
    ]);
  } finally {
    if (!mobile) await page.request.delete(`/api/chats/${chat.id}`);
  }
});

test("AI map expansion preserves a campaign map and its current location", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const response = await page.request.post("/api/chats", {
    data: {
      name: "AI Map Expansion Smoke",
      mode: "roleplay",
      characterIds: [],
    },
  });
  expect(response.ok()).toBeTruthy();
  const chat = (await response.json()) as { id: string };
  const mobile = testInfo.project.name.includes("mobile");

  const anchorResponse = await page.request.post(`/api/chats/${chat.id}/messages`, {
    data: {
      role: "assistant",
      content: "The campaign begins on the Shrouded Coast.",
    },
  });
  expect(anchorResponse.ok()).toBeTruthy();
  const initialSave = await page.request.put(`/api/chats/${chat.id}/spatial-context`, {
    data: {
      expectedRevision: 0,
      expectedCurrentLocationId: null,
      definition: { ...generatedDefinition, enabled: true },
    },
  });
  expect(initialSave.ok()).toBeTruthy();
  expect(((await initialSave.json()) as { hasCommittedSpatialHistory: boolean }).hasCommittedSpatialHistory).toBe(true);

  await page.route(`**/api/chats/${chat.id}/spatial-context/generate`, async (route) => {
    const request = route.request().postDataJSON() as {
      operation: string;
      targetLocationId?: string;
      size: string;
      instructions?: string;
      debugMode: boolean;
    };
    expect(request).toMatchObject({
      operation: "expand",
      targetLocationId: "ai_world",
      size: "small",
      instructions: "Add a riverside ward with an inn for ferrymen.",
      debugMode: false,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        operation: "expand",
        targetLocationId: "ai_world",
        size: "small",
        source: "roleplay_setup",
        generatedLocationCount: 2,
        definition: expandedDefinition,
      }),
    });
  });

  try {
    await page.addInitScript(
      ({ chatId, openEditor }) => {
        localStorage.setItem("marinara-active-chat-id", chatId);
        if (!openEditor) return;
        localStorage.setItem(
          "marinara-engine-ui",
          JSON.stringify({
            state: {
              hasCompletedOnboarding: true,
              rightPanelOpen: false,
              sidebarOpen: false,
              spatialMapDetailChatId: chatId,
            },
            version: 72,
          }),
        );
      },
      { chatId: chat.id, openEditor: mobile },
    );
    await page.route("**/api/backgrounds/file/Black.jpg", async (route) => {
      await route.fulfill({ status: 204, body: "" });
    });
    await page.goto("/");

    if (!mobile) {
      await page.getByRole("button", { name: "Chat Settings" }).click();
      const drawer = page.locator(".mari-chat-settings-drawer");
      await drawer.getByText("Hierarchical map", { exact: true }).click();
      await drawer.getByRole("button", { name: "Edit hierarchical map" }).click();
    }

    await page.getByRole("button", { name: "Expand with AI" }).click();
    await expect(page.getByRole("heading", { name: "Expand the map with AI" })).toBeVisible();
    await expect(page.getByText(/Campaign history is protected/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Replace draft/ })).toHaveCount(0);
    await expect(page.getByLabel("Expand beneath")).toHaveValue("ai_world");
    await page.getByLabel("What should be added?").fill("Add a riverside ward with an inn for ferrymen.");
    await page.getByRole("button", { name: /Small About 8 places/ }).click();
    await page.getByRole("button", { name: "Generate expansion" }).click();
    await expect(page.getByText("Validated", { exact: true })).toBeVisible();
    await expect(page.getByText("2 new locations", { exact: true })).toBeVisible();
    await expect(page.getByText("Riverside Ward", { exact: true })).toBeVisible();

    const beforeApply = await page.request.get(`/api/chats/${chat.id}/spatial-context`);
    expect(((await beforeApply.json()) as { definition: { locations: unknown[] } }).definition.locations).toHaveLength(4);

    await page.getByRole("button", { name: "Add to working map" }).click();
    await expect(page.getByText("AI expansion added to the working map. Review it, then Save.")).toBeVisible();

    const afterApply = await page.request.get(`/api/chats/${chat.id}/spatial-context`);
    expect(((await afterApply.json()) as { definition: { locations: unknown[] } }).definition.locations).toHaveLength(4);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    const storedResponse = await page.request.get(`/api/chats/${chat.id}/spatial-context`);
    const stored = (await storedResponse.json()) as {
      currentLocationId: string;
      definition: { locations: Array<{ id: string }> };
    };
    expect(stored.currentLocationId).toBe("ai_world");
    expect(stored.definition.locations.map((location) => location.id)).toEqual([
      "ai_world",
      "ai_harbor",
      "ai_lighthouse",
      "ai_sewers",
      "ai_riverside",
      "ai_minnow",
    ]);
  } finally {
    if (!mobile) await page.request.delete(`/api/chats/${chat.id}`);
  }
});
