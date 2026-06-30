import { expect, test, type Page } from "@playwright/test";

function collectUnexpectedErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/favicon|ResizeObserver/i.test(text)) return;
    errors.push(text);
  });
  return errors;
}

async function prepareFreshClient(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "marinara-engine-ui",
      JSON.stringify({
        state: {
          hasCompletedOnboarding: true,
          rightPanelOpen: false,
          sidebarOpen: false,
        },
        version: 65,
      }),
    );
  });
}

test.beforeEach(async ({ page }) => {
  await prepareFreshClient(page);
});

test("home shell and primary topbar panels open without client errors", async ({ page }) => {
  const errors = collectUnexpectedErrors(page);
  await page.goto("/");

  await expect(page.locator('[data-component="TopBar"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Marinara Engine" })).toBeVisible();

  for (const selector of [
    '[data-tour="sidebar-toggle"]',
    '[data-tour="panel-bot-browser"]',
    '[data-tour="panel-characters"]',
    '[data-tour="panel-lorebooks"]',
    '[data-tour="panel-presets"]',
    '[data-tour="panel-connections"]',
    '[data-tour="panel-agents"]',
    '[data-tour="panel-personas"]',
    '[data-tour="panel-settings"]',
  ]) {
    await page.locator(selector).click();
    await expect(page.locator('[data-component="TopBar"]')).toBeVisible();
  }

  const health = await page.request.get("/api/health");
  expect(health.ok()).toBeTruthy();
  expect(errors).toEqual([]);
});

test("chat mode tabs and new-chat actions stay reachable", async ({ page }) => {
  const errors = collectUnexpectedErrors(page);
  await page.goto("/");

  await page.locator('[data-tour="sidebar-toggle"]').click();
  await expect(page.locator('[data-component="ChatSidebar"]')).toBeVisible();

  const modes = [
    { tour: "chat-mode-conversation", label: "New Conversation" },
    { tour: "chat-mode-roleplay", label: "New Roleplay" },
    { tour: "chat-mode-game", label: "New Game" },
  ];

  for (const mode of modes) {
    await page.locator(`[data-tour="${mode.tour}"]`).click();
    await expect(page.getByLabel(mode.label)).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test("memory recall modal accepts clicks from chat settings", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Memory recall modal regression is covered on desktop.");

  const response = await page.request.post("/api/chats", {
    data: {
      name: "Memory Recall Menu Smoke",
      mode: "conversation",
      characterIds: [],
    },
  });
  expect(response.ok()).toBeTruthy();
  const chat = (await response.json()) as { id: string };

  await page.addInitScript((chatId) => {
    localStorage.setItem("marinara-active-chat-id", chatId);
  }, chat.id);
  await page.goto("/");

  await page.getByRole("button", { name: "Chat Settings" }).click();
  const drawer = page.locator(".mari-chat-settings-drawer");
  await expect(drawer.getByRole("heading", { name: "Chat Settings" })).toBeVisible();
  await drawer.getByText("Memory Recall", { exact: true }).click();
  await drawer.getByRole("button", { name: "Access memories for this chat" }).click();

  const dialog = page.getByRole("dialog", { name: "Memories for This Chat" });
  await expect(dialog).toBeVisible();
  await dialog.getByText("0 memory chunks").click();
  await expect(dialog).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Chat Settings" })).toBeVisible();
});

test("mobile topbar remains reachable while sidebars switch", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile shell smoke only runs in the mobile project.");

  const errors = collectUnexpectedErrors(page);
  await page.goto("/");

  await page.locator('[data-tour="sidebar-toggle"]').click();
  await expect(page.locator('[data-component="TopBar"]')).toBeVisible();
  await expect(page.locator('[data-component="ChatSidebar"]')).toBeVisible();

  await page.locator('[data-tour="panel-characters"]').click();
  await expect(page.locator('[data-component="TopBar"]')).toBeVisible();
  await expect(page.locator('[data-component="RightPanelMobile"]')).toBeVisible();

  await page.locator('[data-tour="panel-settings"]').click();
  await expect(page.locator('[data-component="TopBar"]')).toBeVisible();
  await expect(page.locator('[data-component="RightPanelMobile"]')).toBeVisible();

  expect(errors).toEqual([]);
});
