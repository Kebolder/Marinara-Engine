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

async function expectHomeContentFits(page: Page) {
  const home = page.locator('[data-component="ChatArea.EmptyState"]');
  await expect
    .poll(async () => {
      return home.evaluate((homeElement) => {
        const contentElement = homeElement.querySelector<HTMLElement>('[data-component="ChatArea.HomeContent"]');
        if (!contentElement) return false;
        const homeRect = homeElement.getBoundingClientRect();
        const contentRect = contentElement.getBoundingClientRect();
        return contentRect.top >= homeRect.top - 1 && contentRect.bottom <= homeRect.bottom + 1;
      });
    })
    .toBe(true);
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

test("home page stays fitted while FAQ behavior matches the viewport", async ({ page }, testInfo) => {
  const errors = collectUnexpectedErrors(page);
  const mobile = testInfo.project.name.includes("mobile");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const home = page.locator('[data-component="ChatArea.EmptyState"]');
  const content = page.locator('[data-component="ChatArea.HomeContent"]');
  await expect(home).toBeVisible();
  await expect(content).toBeVisible();

  await expectHomeContentFits(page);
  await expect(home).toHaveCSS("overflow-y", "hidden");
  const defaultScale = await content.evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    return transform === "none" ? 1 : new DOMMatrix(transform).a;
  });
  expect(defaultScale).toBeGreaterThanOrEqual(0.9);

  const inlineFaq = page.locator('[data-component="HomeFaq.Compact"]');
  const mobileFaqLauncher = page.locator('[data-component="HomeFaq.MobileLauncher"]');

  if (mobile) {
    await expect(inlineFaq).toBeHidden();
    await expect(mobileFaqLauncher).toBeVisible();
    await expect(mobileFaqLauncher.locator(".lucide-chevron-right")).toHaveCount(0);

    const recentChats = page.locator('[data-component="RecentChats"]');
    const mariPanel = page.locator('[data-component="HomeProfessorMariChat.MariPanel"]');
    const mariSprite = page.locator('[data-component="HomeProfessorMariChat.Scene"] [data-part="sprite"]');
    const mobileGeometry = await Promise.all([
      recentChats.boundingBox(),
      mariPanel.boundingBox(),
      mariSprite.boundingBox(),
    ]);
    const [recentRect, panelRect, spriteRect] = mobileGeometry;
    expect(recentRect).not.toBeNull();
    expect(panelRect).not.toBeNull();
    expect(spriteRect).not.toBeNull();
    expect(spriteRect!.y).toBeLessThan(panelRect!.y);
    expect(spriteRect!.y).toBeGreaterThanOrEqual(recentRect!.y + recentRect!.height);

    await mobileFaqLauncher.getByRole("button", { name: "Open Professor Mari's FAQ" }).click();
    const faqDialog = page.getByRole("dialog", { name: "Professor Mari's FAQ" });
    await expect(faqDialog).toBeVisible();
    await expect(faqDialog.getByRole("searchbox", { name: "Search FAQ" })).toBeVisible();
    await expect(faqDialog.getByText("Start here before you go hunting through Discord logs.")).toHaveCount(0);
    await expect(faqDialog.getByText("Before You Post A Bug")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(faqDialog).toBeHidden();
  } else {
    await expect(mobileFaqLauncher).toBeHidden();
    await expect(inlineFaq).toBeVisible();
    const desktopFaqHeader = inlineFaq.locator('[data-component="HomeFaq.DesktopHeader"]');
    await expect(desktopFaqHeader).toBeVisible();
    expect(await desktopFaqHeader.evaluate((element) => element.tagName)).toBe("DIV");
    await expect(inlineFaq.locator('[data-component="HomeFaq.CompactList"]')).toBeVisible();

    const faqPanel = page.locator('[data-component="HomeProfessorMariChat.FaqPanel"]');
    const [faqPanelRect, inlineFaqRect] = await Promise.all([faqPanel.boundingBox(), inlineFaq.boundingBox()]);
    expect(faqPanelRect).not.toBeNull();
    expect(inlineFaqRect).not.toBeNull();
    expect(
      Math.abs(faqPanelRect!.y + faqPanelRect!.height - (inlineFaqRect!.y + inlineFaqRect!.height)),
    ).toBeLessThanOrEqual(12);

    const mariWelcome = page.locator('[data-component="HomeProfessorMariChat.Welcome"]');
    await expect(mariWelcome).toBeVisible();
    const mariWelcomeFits = await mariWelcome.evaluate((element) => element.scrollHeight <= element.clientHeight + 1);
    expect(mariWelcomeFits).toBe(true);
  }

  await page.setViewportSize({ width: mobile ? 390 : 1024, height: mobile ? 650 : 700 });
  await expectHomeContentFits(page);
  await expect(home).toHaveCSS("overflow-y", "hidden");

  expect(errors).toEqual([]);
});

test("Noodle interface icons consistently use Noodle blue", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "The full Noodle settings surface is covered on desktop.");

  const errors = collectUnexpectedErrors(page);
  await page.goto("/");
  await page.locator('[data-tour="noodle-tab"]').click();

  const noodle = page.locator('[data-component="NoodleView"]');
  await expect(noodle).toBeVisible();

  const expectBlueIcons = async (selector: string) => {
    const iconColors = await page
      .locator(selector)
      .locator("svg:visible")
      .evaluateAll((icons) => Array.from(new Set(icons.map((icon) => getComputedStyle(icon).color))));
    expect(iconColors.length).toBeGreaterThan(0);
    expect(iconColors).toEqual(["rgb(126, 167, 255)"]);
  };

  await expectBlueIcons('[data-component="NoodleView"]');
  await noodle.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(noodle.getByRole("button", { name: "Reset Noodle Timeline" })).toBeVisible();
  const scheduleCard = noodle.locator('[data-component="NoodleView.RefreshSchedule"]');
  await expect(scheduleCard).toBeVisible();
  await expect(scheduleCard.getByText("Automatic schedule")).toBeVisible();
  await expectBlueIcons('[data-component="NoodleView"]');

  const firstBootstrapResponse = await page.request.get("/api/noodle");
  expect(firstBootstrapResponse.ok()).toBe(true);
  const firstBootstrap = (await firstBootstrapResponse.json()) as {
    settings: { refreshesPerDay: number };
    scheduler: { scheduledTimes: string[]; completedTimes: string[] };
  };
  expect(firstBootstrap.scheduler.scheduledTimes).toHaveLength(firstBootstrap.settings.refreshesPerDay);
  const secondBootstrap = (await (await page.request.get("/api/noodle")).json()) as {
    scheduler: { scheduledTimes: string[] };
  };
  expect(secondBootstrap.scheduler.scheduledTimes).toEqual(firstBootstrap.scheduler.scheduledTimes);

  await expect(scheduleCard.locator("[data-noodle-schedule-slot]")).toHaveCount(
    firstBootstrap.scheduler.scheduledTimes.length,
  );
  const pendingRefreshCount = firstBootstrap.scheduler.scheduledTimes.filter(
    (scheduledTime) => !firstBootstrap.scheduler.completedTimes.includes(scheduledTime),
  ).length;
  const rescheduleButtons = scheduleCard.getByRole("button", { name: /^Reschedule refresh / });
  await expect(rescheduleButtons).toHaveCount(pendingRefreshCount);
  if (pendingRefreshCount > 0) {
    await rescheduleButtons.first().click();
    await expect(scheduleCard.getByLabel(/^New time for refresh /)).toBeVisible();
    await expect(scheduleCard.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await scheduleCard.getByRole("button", { name: "Cancel reschedule" }).click();
    await expect(scheduleCard.getByLabel(/^New time for refresh /)).toHaveCount(0);
  }

  await noodle.getByRole("button", { name: "Reset Noodle Timeline" }).click();
  const resetDialog = page.getByRole("dialog", { name: "Reset Noodle Timeline" });
  await expect(resetDialog).toBeVisible();
  await expectBlueIcons('[role="dialog"][aria-label="Reset Noodle Timeline"]');
  await resetDialog.getByRole("button", { name: "Cancel" }).click();

  expect(errors).toEqual([]);
});

test("Noodle posts tag invited characters with @handle mentions", async ({ page }) => {
  const errors = collectUnexpectedErrors(page);
  const activePersonaResponse = await page.request.get("/api/characters/personas/active");
  const activePersona = activePersonaResponse.ok()
    ? ((await activePersonaResponse.json()) as { id?: string } | null)
    : null;
  let personaId = activePersona?.id ?? null;
  let createdPersonaId: string | null = null;
  let createdPostId: string | null = null;
  if (!personaId) {
    const personaResponse = await page.request.post("/api/characters/personas", {
      data: { name: "Noodle Mention Regression", description: "Temporary browser regression persona." },
    });
    expect(personaResponse.ok()).toBe(true);
    const createdPersona = (await personaResponse.json()) as { id: string };
    personaId = createdPersona.id;
    createdPersonaId = createdPersona.id;
    const activateResponse = await page.request.put(`/api/characters/personas/${createdPersona.id}/activate`);
    expect(activateResponse.ok()).toBe(true);
  }

  const initialBootstrapResponse = await page.request.get("/api/noodle");
  expect(initialBootstrapResponse.ok()).toBe(true);
  const initialBootstrap = (await initialBootstrapResponse.json()) as {
    accounts: Array<{ id: string; entityId: string; handle: string }>;
  };
  const professorMariAccount = initialBootstrap.accounts.find((account) => account.entityId === "__professor_mari__");
  expect(professorMariAccount).toBeTruthy();

  try {
    await page.goto("/");
    await page.locator('[data-tour="noodle-tab"]').click();

    const noodle = page.locator('[data-component="NoodleView"]');
    const composer = noodle.locator('[data-component="NoodleView.InlineComposer"]');
    const textarea = composer.getByPlaceholder("What's simmering?");
    await textarea.fill("Dinner with @prof");

    const mentionList = composer.getByRole("listbox", { name: "Tag a character" });
    await expect(mentionList).toBeVisible();
    await mentionList.getByRole("option", { name: /Professor Mari.*@professor_mari/i }).click();
    await expect(textarea).toHaveValue("Dinner with @professor_mari ");
    await textarea.pressSequentially("tonight.");

    const postResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/noodle/posts",
    );
    await composer.getByRole("button", { name: "Post", exact: true }).click();
    const postResponse = await postResponsePromise;
    expect(postResponse.ok()).toBe(true);
    const post = (await postResponse.json()) as {
      id: string;
      metadata: { mentionedAccountIds?: string[] };
    };
    createdPostId = post.id;
    expect(post.metadata.mentionedAccountIds).toContain(professorMariAccount!.id);

    const postArticle = noodle.locator(`[data-noodle-post-id="${post.id}"]`);
    await expect(postArticle).toBeVisible();
    const mention = postArticle.getByRole("button", { name: "View @professor_mari profile" });
    await expect(mention).toBeVisible();

    const updatedBootstrap = (await (await page.request.get("/api/noodle")).json()) as {
      digests: Array<{ sourcePostId: string | null; accountIds: string[] }>;
    };
    const postDigest = updatedBootstrap.digests.find((digest) => digest.sourcePostId === post.id);
    expect(postDigest?.accountIds).toContain(professorMariAccount!.id);

    await mention.click();
    await expect(noodle.getByRole("heading", { name: "Professor Mari", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (createdPostId) {
      await page.request.delete(`/api/noodle/posts/${createdPostId}`, { timeout: 5_000 }).catch(() => undefined);
    }
    if (createdPersonaId) {
      await page.request
        .delete(`/api/characters/personas/${createdPersonaId}`, { timeout: 5_000 })
        .catch(() => undefined);
    }
  }
});

test("Noodle polls support character creation and voting on both sides", async ({ page }) => {
  const errors = collectUnexpectedErrors(page);
  const activePersonaResponse = await page.request.get("/api/characters/personas/active");
  const activePersona = activePersonaResponse.ok()
    ? ((await activePersonaResponse.json()) as { id?: string } | null)
    : null;
  let personaId = activePersona?.id ?? null;
  let createdPersonaId: string | null = null;
  const createdPostIds: string[] = [];
  if (!personaId) {
    const personaResponse = await page.request.post("/api/characters/personas", {
      data: { name: "Noodle Poll Regression", description: "Temporary browser regression persona." },
    });
    expect(personaResponse.ok()).toBe(true);
    const createdPersona = (await personaResponse.json()) as { id: string };
    personaId = createdPersona.id;
    createdPersonaId = createdPersona.id;
    const activateResponse = await page.request.put(`/api/characters/personas/${createdPersona.id}/activate`);
    expect(activateResponse.ok()).toBe(true);
  }

  const initialBootstrapResponse = await page.request.get("/api/noodle");
  expect(initialBootstrapResponse.ok()).toBe(true);
  const initialBootstrap = (await initialBootstrapResponse.json()) as {
    accounts: Array<{ id: string; kind: string; entityId: string }>;
  };
  const professorMariAccount = initialBootstrap.accounts.find((account) => account.entityId === "__professor_mari__");
  const personaAccount = initialBootstrap.accounts.find(
    (account) => account.kind === "persona" && account.entityId === personaId,
  );
  expect(professorMariAccount).toBeTruthy();
  expect(personaAccount).toBeTruthy();

  const characterPollResponse = await page.request.post("/api/noodle/posts", {
    data: {
      authorKind: "character",
      authorEntityId: "__professor_mari__",
      content: "Help me choose the laboratory tea.",
      poll: { question: "Which tea should I brew?", options: ["Jasmine", "Earl Grey"] },
    },
  });
  expect(characterPollResponse.ok()).toBe(true);
  const characterPollPost = (await characterPollResponse.json()) as {
    id: string;
    metadata: { poll?: { options: Array<{ id: string; label: string }> } };
  };
  createdPostIds.push(characterPollPost.id);
  expect(characterPollPost.metadata.poll?.options).toHaveLength(2);

  try {
    await page.goto("/");
    await page.locator('[data-tour="noodle-tab"]').click();

    const noodle = page.locator('[data-component="NoodleView"]');
    const characterPollArticle = noodle.locator(`[data-noodle-post-id="${characterPollPost.id}"]`);
    await expect(characterPollArticle.getByRole("region", { name: "Poll: Which tea should I brew?" })).toBeVisible();
    const jasmineOption = characterPollArticle.locator('[data-noodle-poll-option="option-1"]');
    const earlGreyOption = characterPollArticle.locator('[data-noodle-poll-option="option-2"]');

    await jasmineOption.click();
    await expect(jasmineOption).toHaveAttribute("aria-pressed", "true");
    await expect(characterPollArticle.getByText("1 vote · You voted")).toBeVisible();
    await earlGreyOption.click();
    await expect(earlGreyOption).toHaveAttribute("aria-pressed", "true");
    await expect(jasmineOption).toHaveAttribute("aria-pressed", "false");
    await expect(characterPollArticle.getByText("1 vote · You voted")).toBeVisible();

    const voteBootstrap = (await (await page.request.get("/api/noodle")).json()) as {
      interactions: Array<{
        postId: string;
        actorAccountId: string;
        type: string;
        content: string | null;
      }>;
    };
    const personaVotes = voteBootstrap.interactions.filter(
      (interaction) =>
        interaction.postId === characterPollPost.id &&
        interaction.actorAccountId === personaAccount!.id &&
        interaction.type === "vote",
    );
    expect(personaVotes).toHaveLength(1);
    expect(personaVotes[0]?.content).toBe("option-2");

    const composer = noodle.locator('[data-component="NoodleView.InlineComposer"]');
    await composer.getByTitle("Create poll").click();
    await page.getByPlaceholder("Ask a question").fill("Which experiment comes next?");
    await page.getByPlaceholder("Option 1").fill("Robotics");
    await page.getByPlaceholder("Option 2").fill("Alchemy");
    await page.getByRole("button", { name: "Add Poll", exact: true }).click();
    await expect(composer.locator('[data-component="NoodleView.DraftPoll"]')).toBeVisible();

    const personaPollResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/noodle/posts",
    );
    await composer.getByRole("button", { name: "Post", exact: true }).click();
    const personaPollResponse = await personaPollResponsePromise;
    expect(personaPollResponse.ok()).toBe(true);
    const personaPollPost = (await personaPollResponse.json()) as {
      id: string;
      metadata: { poll?: { question: string; options: Array<{ id: string }> } };
    };
    createdPostIds.push(personaPollPost.id);
    expect(personaPollPost.metadata.poll?.question).toBe("Which experiment comes next?");

    const characterVoteResponse = await page.request.post(`/api/noodle/posts/${personaPollPost.id}/interactions`, {
      data: {
        actorKind: "character",
        actorEntityId: "__professor_mari__",
        type: "vote",
        content: personaPollPost.metadata.poll?.options[0]?.id,
      },
    });
    expect(characterVoteResponse.ok()).toBe(true);
    const characterVote = (await characterVoteResponse.json()) as {
      actorAccountId: string;
      type: string;
      content: string | null;
    };
    expect(characterVote.actorAccountId).toBe(professorMariAccount!.id);
    expect(characterVote.type).toBe("vote");
    expect(characterVote.content).toBe("option-1");
    expect(errors).toEqual([]);
  } finally {
    for (const postId of createdPostIds) {
      await page.request.delete(`/api/noodle/posts/${postId}`, { timeout: 5_000 }).catch(() => undefined);
    }
    if (createdPersonaId) {
      await page.request
        .delete(`/api/characters/personas/${createdPersonaId}`, { timeout: 5_000 })
        .catch(() => undefined);
    }
  }
});

test("liking one Noodle post leaves unrelated reaction controls visually stable", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Reaction stability is covered on desktop.");

  const errors = collectUnexpectedErrors(page);
  const activePersonaResponse = await page.request.get("/api/characters/personas/active");
  const activePersona = activePersonaResponse.ok()
    ? ((await activePersonaResponse.json()) as { id?: string } | null)
    : null;
  let personaId = activePersona?.id ?? null;
  let createdPersonaId: string | null = null;
  const createdPostIds: string[] = [];
  let releaseReactionRequest: (() => void) | null = null;
  if (!personaId) {
    const personaResponse = await page.request.post("/api/characters/personas", {
      data: { name: "Noodle Reaction Regression", description: "Temporary browser regression persona." },
    });
    expect(personaResponse.ok()).toBe(true);
    const createdPersona = (await personaResponse.json()) as { id: string };
    personaId = createdPersona.id;
    createdPersonaId = createdPersona.id;
    const activateResponse = await page.request.put(`/api/characters/personas/${createdPersona.id}/activate`);
    expect(activateResponse.ok()).toBe(true);
  }

  await page.request.get("/api/noodle");
  for (const label of ["First", "Second"]) {
    const response = await page.request.post("/api/noodle/posts", {
      data: {
        authorKind: "persona",
        authorEntityId: personaId,
        content: `${label} reaction stability post ${Date.now()}`,
      },
    });
    expect(response.ok()).toBe(true);
    createdPostIds.push(((await response.json()) as { id: string }).id);
  }

  try {
    await page.goto("/");
    await page.locator('[data-tour="noodle-tab"]').click();

    const noodle = page.locator('[data-component="NoodleView"]');
    const targetPost = noodle.locator(`[data-noodle-post-id="${createdPostIds[0]}"]`);
    const unrelatedPost = noodle.locator(`[data-noodle-post-id="${createdPostIds[1]}"]`);
    await expect(targetPost).toBeVisible();
    await expect(unrelatedPost).toBeVisible();

    const targetLike = targetPost.getByRole("button", { name: "Like post" });
    const unrelatedLike = unrelatedPost.getByRole("button", { name: "Like post" });
    await expect(targetLike.locator("svg")).toHaveAttribute("fill", "none");
    const unrelatedClass = await unrelatedLike.getAttribute("class");
    const unrelatedText = await unrelatedLike.textContent();
    let markReactionRequestStarted: (() => void) | null = null;
    const reactionRequestStarted = new Promise<void>((resolve) => {
      markReactionRequestStarted = resolve;
    });
    const releaseReaction = new Promise<void>((resolve) => {
      releaseReactionRequest = resolve;
    });
    await page.route("**/api/noodle/posts/*/interactions", async (route) => {
      if (route.request().method() === "POST") {
        markReactionRequestStarted?.();
        await releaseReaction;
      }
      await route.continue();
    });

    let bootstrapRequestsAfterLike = 0;
    let countBootstrapRequests = false;
    page.on("request", (request) => {
      if (countBootstrapRequests && request.method() === "GET" && new URL(request.url()).pathname === "/api/noodle") {
        bootstrapRequestsAfterLike += 1;
      }
    });

    countBootstrapRequests = true;
    await targetLike.click();
    await reactionRequestStarted;
    await expect(targetLike).toBeDisabled();
    await expect(targetLike).toHaveAttribute("aria-busy", "true");
    await expect(unrelatedLike).toBeEnabled();
    await expect(unrelatedLike).toHaveAttribute("class", unrelatedClass ?? "");
    await expect(unrelatedLike).toHaveText(unrelatedText ?? "");

    releaseReactionRequest?.();
    releaseReactionRequest = null;
    const targetUnlike = targetPost.getByRole("button", { name: "Unlike post" });
    await expect(targetUnlike).toBeEnabled();
    await expect(targetUnlike.locator("svg")).toHaveAttribute("fill", "currentColor");
    await expect(targetPost.locator('[data-noodle-reaction="like"]')).toContainText("1");
    await expect(unrelatedLike).toBeEnabled();
    await page.waitForTimeout(150);
    expect(bootstrapRequestsAfterLike).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    releaseReactionRequest?.();
    for (const postId of createdPostIds) {
      await page.request.delete(`/api/noodle/posts/${postId}`, { timeout: 5_000 }).catch(() => undefined);
    }
    if (createdPersonaId) {
      await page.request
        .delete(`/api/characters/personas/${createdPersonaId}`, { timeout: 5_000 })
        .catch(() => undefined);
    }
  }
});

test("Noodle persona and character comments can be edited and deleted", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "Comment ownership controls are covered on desktop.");

  const errors = collectUnexpectedErrors(page);
  let personaId: string | null = null;
  let createdPersonaId: string | null = null;
  let postId: string | null = null;
  let controlPostId: string | null = null;

  try {
    const activePersonaResponse = await page.request.get("/api/characters/personas/active");
    const activePersona = activePersonaResponse.ok()
      ? ((await activePersonaResponse.json()) as { id?: string } | null)
      : null;
    personaId = activePersona?.id ?? null;
    if (!personaId) {
      const personaResponse = await page.request.post("/api/characters/personas", {
        data: { name: "Noodle Comment Owner", description: "Temporary browser regression persona." },
      });
      expect(personaResponse.ok()).toBe(true);
      const createdPersona = (await personaResponse.json()) as { id: string };
      personaId = createdPersona.id;
      createdPersonaId = createdPersona.id;
      const activateResponse = await page.request.put(`/api/characters/personas/${createdPersona.id}/activate`);
      expect(activateResponse.ok()).toBe(true);
    }

    await page.request.get("/api/noodle");
    const postResponse = await page.request.post("/api/noodle/posts", {
      data: {
        authorKind: "character",
        authorEntityId: "__professor_mari__",
        content: `Comment ownership regression ${Date.now()}`,
      },
    });
    expect(postResponse.ok()).toBe(true);
    const post = (await postResponse.json()) as { id: string };
    postId = post.id;
    const controlPostResponse = await page.request.post("/api/noodle/posts", {
      data: {
        authorKind: "character",
        authorEntityId: "__professor_mari__",
        content: `Newer control post ${Date.now()}`,
      },
    });
    expect(controlPostResponse.ok()).toBe(true);
    const controlPost = (await controlPostResponse.json()) as { id: string };
    controlPostId = controlPost.id;

    const ownReplyResponse = await page.request.post(`/api/noodle/posts/${postId}/interactions`, {
      data: {
        actorKind: "persona",
        actorEntityId: personaId,
        type: "reply",
        content: "Original persona comment.",
      },
    });
    expect(ownReplyResponse.ok()).toBe(true);
    const ownReply = (await ownReplyResponse.json()) as { id: string };

    const childReplyResponse = await page.request.post(`/api/noodle/posts/${postId}/interactions`, {
      data: {
        actorKind: "character",
        actorEntityId: "__professor_mari__",
        type: "reply",
        content: "Character-owned child reply.",
        parentInteractionId: ownReply.id,
      },
    });
    expect(childReplyResponse.ok()).toBe(true);
    const childReply = (await childReplyResponse.json()) as { id: string };

    await page.goto("/");
    await page.locator('[data-tour="noodle-tab"]').click();

    const noodle = page.locator('[data-component="NoodleView"]');
    const activePost = noodle.locator(`[data-noodle-post-id="${postId}"]`);
    const newerControlPost = noodle.locator(`[data-noodle-post-id="${controlPostId}"]`);
    const ownComment = noodle.locator(`[data-noodle-interaction-id="${ownReply.id}"]`);
    const characterComment = noodle.locator(`[data-noodle-interaction-id="${childReply.id}"]`);
    await expect(newerControlPost).toBeVisible();
    await expect(ownComment).toBeVisible();
    await expect(characterComment).toBeVisible();
    expect(
      await activePost.evaluate((element, controlPostId) => {
        const control = document.querySelector(`[data-noodle-post-id="${controlPostId}"]`);
        return Boolean(control && element.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING);
      }, controlPostId),
    ).toBe(true);
    await expect(ownComment.getByRole("button", { name: "Edit comment" })).toBeVisible();
    await expect(ownComment.getByRole("button", { name: "Delete comment" })).toBeVisible();
    await expect(characterComment.getByRole("button", { name: "Edit comment" })).toBeVisible();
    await expect(characterComment.getByRole("button", { name: "Delete comment" })).toBeVisible();

    await characterComment.getByRole("button", { name: "Edit comment" }).click();
    const characterEditor = characterComment.locator('[data-component="NoodleView.CommentEditor"]');
    await characterEditor.getByRole("textbox", { name: "Edit comment" }).fill("Edited character reply.");
    await characterEditor.getByRole("button", { name: "Save" }).click();
    await expect(characterComment).toContainText("Edited character reply.");

    await characterComment.getByRole("button", { name: "Delete comment" }).click();
    const characterDeleteDialog = page.getByRole("dialog", { name: "Delete Noodle Comment" });
    await expect(characterDeleteDialog).toBeVisible();
    await characterDeleteDialog.getByRole("button", { name: "Delete comment" }).click();
    await expect(characterComment).toHaveCount(0);
    await expect(ownComment).toBeVisible();

    await ownComment.getByRole("button", { name: "Edit comment" }).click();
    const editor = ownComment.locator('[data-component="NoodleView.CommentEditor"]');
    await editor.getByRole("textbox", { name: "Edit comment" }).fill("Edited persona comment.");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(ownComment).toContainText("Edited persona comment.");

    await ownComment.getByRole("button", { name: "Delete comment" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Delete Noodle Comment" });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole("button", { name: "Delete comment" }).click();
    await expect(ownComment).toHaveCount(0);
    await expect(characterComment).toHaveCount(0);

    expect(errors).toEqual([]);
  } finally {
    if (postId) {
      await page.request.delete(`/api/noodle/posts/${postId}`, { timeout: 5_000 }).catch(() => undefined);
    }
    if (controlPostId) {
      await page.request.delete(`/api/noodle/posts/${controlPostId}`, { timeout: 5_000 }).catch(() => undefined);
    }
    if (createdPersonaId) {
      await page.request
        .delete(`/api/characters/personas/${createdPersonaId}`, { timeout: 5_000 })
        .catch(() => undefined);
    }
  }
});

test("Noodle post and reply composers autocomplete character handles", async ({ page }) => {
  const errors = collectUnexpectedErrors(page);
  let personaId: string | null = null;
  let createdPersonaId: string | null = null;
  let postId: string | null = null;

  try {
    const activePersonaResponse = await page.request.get("/api/characters/personas/active");
    const activePersona = activePersonaResponse.ok()
      ? ((await activePersonaResponse.json()) as { id?: string } | null)
      : null;
    personaId = activePersona?.id ?? null;
    if (!personaId) {
      const personaResponse = await page.request.post("/api/characters/personas", {
        data: { name: "Noodle Mention Tester", description: "Temporary browser regression persona." },
      });
      expect(personaResponse.ok()).toBe(true);
      const createdPersona = (await personaResponse.json()) as { id: string };
      personaId = createdPersona.id;
      createdPersonaId = createdPersona.id;
      const activateResponse = await page.request.put(`/api/characters/personas/${createdPersona.id}/activate`);
      expect(activateResponse.ok()).toBe(true);
    }

    const bootstrapResponse = await page.request.get("/api/noodle");
    expect(bootstrapResponse.ok()).toBe(true);
    const bootstrap = (await bootstrapResponse.json()) as {
      accounts: Array<{ entityId: string; handle: string; kind: string; invited: boolean }>;
    };
    const mentionAccount = bootstrap.accounts.find(
      (account) => account.kind === "character" && account.invited && account.handle.length > 0,
    );
    expect(mentionAccount).toBeDefined();

    const postResponse = await page.request.post("/api/noodle/posts", {
      data: {
        authorKind: "character",
        authorEntityId: mentionAccount!.entityId,
        content: `Mention autocomplete regression ${Date.now()}`,
      },
    });
    expect(postResponse.ok()).toBe(true);
    const post = (await postResponse.json()) as { id: string };
    postId = post.id;
    const commentResponse = await page.request.post(`/api/noodle/posts/${post.id}/interactions`, {
      data: {
        actorKind: "character",
        actorEntityId: mentionAccount!.entityId,
        type: "reply",
        content: "A comment waiting for a tagged response.",
      },
    });
    expect(commentResponse.ok()).toBe(true);
    const comment = (await commentResponse.json()) as { id: string };

    await page.goto("/");
    await page.locator('[data-tour="noodle-tab"]').click();

    const noodle = page.locator('[data-component="NoodleView"]');
    const mentionPrefix = mentionAccount!.handle.slice(0, Math.min(2, mentionAccount!.handle.length));
    const inlineComposer = noodle.locator('[data-component="NoodleView.InlineComposer"]');
    const postTextarea = inlineComposer.getByPlaceholder("What's simmering?");
    await postTextarea.fill(`Hello @${mentionPrefix}`);

    const postMentionList = page.locator("#noodle-inline-mention-list");
    await expect(postMentionList).toBeVisible();
    const postMentionOption = postMentionList
      .getByRole("option")
      .filter({ hasText: `@${mentionAccount!.handle}` });
    await expect(postMentionOption).toBeVisible();
    await postMentionOption.click();
    await expect(postTextarea).toHaveValue(`Hello @${mentionAccount!.handle} `);

    const activePost = noodle.locator(`[data-noodle-post-id="${postId}"]`);
    const targetComment = activePost.locator(`[data-noodle-interaction-id="${comment.id}"]`);
    await targetComment.getByTitle("Reply").click();
    const replyComposer = activePost.locator(
      `[data-component="NoodleView.ReplyComposer"][data-noodle-reply-parent-id="${comment.id}"]`,
    );
    const replyTextarea = replyComposer.getByPlaceholder("Leave a comment…");
    await replyTextarea.fill(`Replying @${mentionAccount!.handle}`);

    const replyMentionList = page.locator("#noodle-reply-mention-list");
    await expect(replyMentionList).toBeVisible();
    const replyMentionOption = replyMentionList
      .getByRole("option")
      .filter({ hasText: `@${mentionAccount!.handle}` });
    await expect(replyMentionOption).toBeVisible();
    await replyTextarea.press("Tab");
    await expect(replyTextarea).toHaveValue(`Replying @${mentionAccount!.handle} `);

    expect(errors).toEqual([]);
  } finally {
    if (postId) {
      await page.request.delete(`/api/noodle/posts/${postId}`, { timeout: 5_000 }).catch(() => undefined);
    }
    if (createdPersonaId) {
      await page.request
        .delete(`/api/characters/personas/${createdPersonaId}`, { timeout: 5_000 })
        .catch(() => undefined);
    }
  }
});

test("Noodle desktop composers insert emojis at the active cursor", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Desktop cursor placement is covered in the desktop shell.");

  const errors = collectUnexpectedErrors(page);
  let createdPersonaId: string | null = null;
  let postId: string | null = null;

  try {
    const activePersonaResponse = await page.request.get("/api/characters/personas/active");
    const activePersona = activePersonaResponse.ok()
      ? ((await activePersonaResponse.json()) as { id?: string } | null)
      : null;
    if (!activePersona?.id) {
      const personaResponse = await page.request.post("/api/characters/personas", {
        data: { name: "Noodle Cursor Tester", description: "Temporary browser regression persona." },
      });
      expect(personaResponse.ok()).toBe(true);
      const createdPersona = (await personaResponse.json()) as { id: string };
      createdPersonaId = createdPersona.id;
      const activateResponse = await page.request.put(`/api/characters/personas/${createdPersona.id}/activate`);
      expect(activateResponse.ok()).toBe(true);
    }

    const bootstrapResponse = await page.request.get("/api/noodle");
    expect(bootstrapResponse.ok()).toBe(true);
    const bootstrap = (await bootstrapResponse.json()) as {
      accounts: Array<{ entityId: string; kind: string; invited: boolean }>;
    };
    const characterAccount = bootstrap.accounts.find(
      (account) => account.kind === "character" && account.invited,
    );
    expect(characterAccount).toBeDefined();

    const postResponse = await page.request.post("/api/noodle/posts", {
      data: {
        authorKind: "character",
        authorEntityId: characterAccount!.entityId,
        content: `Emoji cursor regression ${Date.now()}`,
      },
    });
    expect(postResponse.ok()).toBe(true);
    const post = (await postResponse.json()) as { id: string };
    postId = post.id;

    await page.goto("/");
    await page.locator('[data-tour="noodle-tab"]').click();

    const noodle = page.locator('[data-component="NoodleView"]');
    const inlineComposer = noodle.locator('[data-component="NoodleView.InlineComposer"]');
    const postTextarea = inlineComposer.getByPlaceholder("What's simmering?");
    await postTextarea.fill("Alpha Omega");
    await postTextarea.evaluate((element: HTMLTextAreaElement) => {
      element.focus();
      element.setSelectionRange(6, 6);
    });
    await inlineComposer.getByTitle("Emoji, GIFs and stickers").click();
    await page.getByRole("textbox", { name: "Search emojis" }).fill("test tube");
    await page.getByRole("button", { name: /test tube/i }).click();
    await expect(postTextarea).toHaveValue("Alpha 🧪Omega");
    await expect
      .poll(() => postTextarea.evaluate((element: HTMLTextAreaElement) => element.selectionStart))
      .toBe(8);
    await expect
      .poll(() => postTextarea.evaluate((element: HTMLTextAreaElement) => element.selectionEnd))
      .toBe(8);
    await inlineComposer.getByTitle("Emoji, GIFs and stickers").click();

    const activePost = noodle.locator(`[data-noodle-post-id="${post.id}"]`);
    await activePost.getByTitle("Reply").first().click();
    const replyComposer = activePost.locator('[data-component="NoodleView.ReplyComposer"]');
    const replyTextarea = replyComposer.getByPlaceholder("Leave a comment…");
    await replyTextarea.fill("Reply here");
    await replyTextarea.evaluate((element: HTMLTextAreaElement) => {
      element.focus();
      element.setSelectionRange(6, 10);
    });
    await replyComposer.getByTitle("Emoji, GIFs and stickers").click();
    await page.getByRole("textbox", { name: "Search emojis" }).fill("test tube");
    await page.getByRole("button", { name: /test tube/i }).click();
    await expect(replyTextarea).toHaveValue("Reply 🧪");
    await expect
      .poll(() => replyTextarea.evaluate((element: HTMLTextAreaElement) => element.selectionStart))
      .toBe(8);
    await expect
      .poll(() => replyTextarea.evaluate((element: HTMLTextAreaElement) => element.selectionEnd))
      .toBe(8);

    expect(errors).toEqual([]);
  } finally {
    if (postId) {
      await page.request.delete(`/api/noodle/posts/${postId}`, { timeout: 5_000 }).catch(() => undefined);
    }
    if (createdPersonaId) {
      await page.request
        .delete(`/api/characters/personas/${createdPersonaId}`, { timeout: 5_000 })
        .catch(() => undefined);
    }
  }
});

test("Noodle reply notifications focus the actionable timeline reply", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Reply notification focus is covered on mobile.");

  const errors = collectUnexpectedErrors(page);
  const activePersonaResponse = await page.request.get("/api/characters/personas/active");
  const activePersona = activePersonaResponse.ok()
    ? ((await activePersonaResponse.json()) as { id?: string } | null)
    : null;
  let personaId = activePersona?.id ?? null;
  let createdPersonaId: string | null = null;
  if (!personaId) {
    const personaResponse = await page.request.post("/api/characters/personas", {
      data: { name: "Noodle Notification Regression", description: "Temporary browser regression persona." },
    });
    expect(personaResponse.ok()).toBe(true);
    const createdPersona = (await personaResponse.json()) as { id: string };
    personaId = createdPersona.id;
    createdPersonaId = createdPersona.id;
    const activateResponse = await page.request.put(`/api/characters/personas/${createdPersona.id}/activate`);
    expect(activateResponse.ok()).toBe(true);
  }

  await page.request.get("/api/noodle");
  const postResponse = await page.request.post("/api/noodle/posts", {
    data: {
      authorKind: "persona",
      authorEntityId: personaId,
      content: `Notification focus regression ${Date.now()}`,
    },
  });
  expect(postResponse.ok()).toBe(true);
  const post = (await postResponse.json()) as { id: string };

  try {
    const replyResponse = await page.request.post(`/api/noodle/posts/${post.id}/interactions`, {
      data: {
        actorKind: "character",
        actorEntityId: "__professor_mari__",
        type: "reply",
        content: "A focused reply regression check.",
      },
    });
    expect(replyResponse.ok()).toBe(true);
    const reply = (await replyResponse.json()) as { id: string };

    await page.goto("/");
    await page.locator('[data-tour="noodle-tab"]').click();

    const noodle = page.locator('[data-component="NoodleView"]');
    const notificationsButton = noodle.getByRole("button", { name: "Noodle notifications" });
    await expect(notificationsButton.locator('[data-component="NoodleView.NotificationBadge"]')).toBeVisible();
    await notificationsButton.click();
    await expect(noodle.locator('[data-component="NoodleView.NotificationBadge"]')).toHaveCount(0);
    await noodle.getByRole("button", { name: "Replies", exact: true }).click();

    const notification = noodle.locator(`[data-noodle-notification-target="${reply.id}"]`);
    await expect(notification).toBeVisible();
    await notification.click();

    const focusedReply = noodle.locator(`[data-noodle-interaction-id="${reply.id}"]`);
    await expect(focusedReply).toBeVisible();
    await expect(focusedReply).toBeFocused();
    await expect(focusedReply.getByTitle(/Like comment|Unlike comment/)).toBeVisible();
    await expect(focusedReply.getByTitle("Reply")).toBeVisible();

    await focusedReply.getByTitle("Reply").click();
    const nestedComposer = noodle.locator(
      `[data-component="NoodleView.ReplyComposer"][data-noodle-reply-parent-id="${reply.id}"]`,
    );
    await expect(nestedComposer).toBeVisible();
    await expect(nestedComposer).toContainText("Replying to");
    const [replyRect, composerRect] = await Promise.all([focusedReply.boundingBox(), nestedComposer.boundingBox()]);
    expect(replyRect).not.toBeNull();
    expect(composerRect).not.toBeNull();
    expect(composerRect!.y).toBeGreaterThanOrEqual(replyRect!.y + replyRect!.height - 1);
    expect(
      await nestedComposer.evaluate((composer, interactionId) => {
        const target = document.querySelector(`[data-noodle-interaction-id="${interactionId}"]`);
        return Boolean(target && target.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING);
      }, reply.id),
    ).toBe(true);

    await nestedComposer.getByTitle("Attach image").click();
    const replyImageDivider = page.locator('[data-component="NoodleView.ReplyImageDivider"]');
    await expect(replyImageDivider).toBeVisible();
    await expect(replyImageDivider).toHaveCSS("color", "rgb(126, 167, 255)");

    expect(errors).toEqual([]);
  } finally {
    await page.request.delete(`/api/noodle/posts/${post.id}`, { timeout: 5_000 }).catch(() => undefined);
    if (createdPersonaId) {
      await page.request
        .delete(`/api/characters/personas/${createdPersonaId}`, { timeout: 5_000 })
        .catch(() => undefined);
    }
  }
});

test("Noodle mobile shell keeps navigation usable across every view", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "The responsive Noodle shell is covered on mobile.");

  const errors = collectUnexpectedErrors(page);
  await page.goto("/");
  await page.locator('[data-tour="noodle-tab"]').click();

  const noodle = page.locator('[data-component="NoodleView"]');
  const header = noodle.locator('[data-component="NoodleView.MobileHeader"]');
  const bottomNav = noodle.locator('[data-component="NoodleView.MobileBottomNav"]');
  await expect(header).toBeVisible();
  await expect(bottomNav).toBeVisible();
  await expect(header.locator('img[src="/noodle-klusek.png"]')).toBeVisible();

  const [noodleRect, logoRect, bottomNavRect, bottomNavRowRect] = await Promise.all([
    noodle.boundingBox(),
    header.locator('img[src="/noodle-klusek.png"]').boundingBox(),
    bottomNav.boundingBox(),
    bottomNav.locator(":scope > div").boundingBox(),
  ]);
  expect(noodleRect).not.toBeNull();
  expect(logoRect).not.toBeNull();
  expect(bottomNavRect).not.toBeNull();
  expect(bottomNavRowRect).not.toBeNull();
  expect(Math.abs(logoRect!.x + logoRect!.width / 2 - (noodleRect!.x + noodleRect!.width / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(bottomNavRect!.y + bottomNavRect!.height - (noodleRect!.y + noodleRect!.height))).toBeLessThanOrEqual(
    1,
  );
  expect(bottomNavRowRect!.height).toBe(52);
  expect(bottomNavRect!.height).toBeLessThanOrEqual(58);

  const sawDrawerSlide = await page.evaluate(async () => {
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Open Noodle account menu"]');
    if (!trigger) return false;
    trigger.click();
    const positions: number[] = [];
    for (let frame = 0; frame < 10; frame += 1) {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const drawer = document.querySelector<HTMLElement>('[data-component="NoodleView.MobileDrawer"]');
      if (drawer) positions.push(drawer.getBoundingClientRect().x);
    }
    const first = positions[0];
    const last = positions.at(-1);
    return first !== undefined && last !== undefined && first < -1 && last > first + 10;
  });
  expect(sawDrawerSlide).toBe(true);

  const drawer = page.locator('[data-component="NoodleView.MobileDrawer"]');
  const accountMenu = page.getByRole("dialog", { name: "Noodle account menu" });
  await expect(accountMenu).toBeVisible();
  await expect.poll(() => drawer.evaluate((element) => Math.round(element.getBoundingClientRect().x))).toBe(0);
  const [drawerRect, topBarRect] = await Promise.all([
    drawer.boundingBox(),
    page.locator('[data-component="TopBar"]').boundingBox(),
  ]);
  expect(drawerRect).not.toBeNull();
  expect(topBarRect).not.toBeNull();
  expect(Math.abs(drawerRect!.x - noodleRect!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(drawerRect!.y - noodleRect!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(drawerRect!.width - noodleRect!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(drawerRect!.height - noodleRect!.height)).toBeLessThanOrEqual(1);
  expect(drawerRect!.y).toBeGreaterThanOrEqual(topBarRect!.y + topBarRect!.height - 1);
  for (const item of ["Home", "Profile", "Settings", "Post"]) {
    await expect(accountMenu.getByRole("button", { name: item, exact: true })).toBeVisible();
  }
  await expect(accountMenu.getByRole("button", { name: "Switch account" })).toBeVisible();

  const retainedDuringCollapse = await page.evaluate(async () => {
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close Noodle account menu"]');
    close?.click();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    return Boolean(document.querySelector('[data-component="NoodleView.MobileDrawer"]'));
  });
  expect(retainedDuringCollapse).toBe(true);
  await expect(drawer).toHaveCount(0);

  await noodle.getByRole("button", { name: "Open Noodle account menu" }).click();
  await expect(accountMenu).toBeVisible();
  await accountMenu.getByRole("button", { name: "Post", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  const composer = page.getByRole("heading", { name: "New post" });
  await expect(composer).toBeVisible();
  await page.getByRole("button", { name: "Close post composer" }).click();

  await noodle.getByRole("button", { name: "Open Noodle account menu" }).click();
  await accountMenu.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(noodle.getByRole("heading", { name: "Noodle settings" })).toBeVisible();
  await expect(bottomNav).toBeVisible();
  await noodle.getByRole("button", { name: "Back to Noodle timeline" }).click();
  await expect(header).toBeVisible();

  await noodle.getByRole("button", { name: "Open Noodle account menu" }).click();
  await accountMenu.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(drawer).toHaveCount(0);

  const timelineScroller = noodle.locator("main");
  await timelineScroller.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  expect(await timelineScroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await bottomNav.getByRole("button", { name: "Noodle home" }).click();
  await expect(header).toBeVisible();
  await expect.poll(() => timelineScroller.evaluate((element) => element.scrollTop)).toBe(0);

  await noodle.getByRole("button", { name: "Open Noodle account menu" }).click();
  await accountMenu.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(noodle.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
  await expect(bottomNav).toBeVisible();
  await noodle.getByRole("button", { name: "Back to Noodle timeline" }).click();
  await expect(header).toBeVisible();

  await bottomNav.getByRole("button", { name: "Search Noodle" }).click();
  const searchInput = noodle.getByRole("searchbox", { name: "Search Noodle" });
  await expect(searchInput).toBeVisible();
  await expect(noodle.getByRole("heading", { name: "Who to follow" })).toBeVisible();
  await expect(bottomNav).toBeVisible();
  await noodle.getByRole("button", { name: "Back to Noodle timeline" }).click();
  await expect(header).toBeVisible();

  await bottomNav.getByRole("button", { name: "Search Noodle" }).click();
  await searchInput.fill("Professor");
  await expect(noodle.getByRole("heading", { name: "Search results" })).toBeVisible();
  await bottomNav.getByRole("button", { name: "Noodle home" }).click();
  await expect(header).toBeVisible();
  await bottomNav.getByRole("button", { name: "Search Noodle" }).click();
  await expect(searchInput).toHaveValue("");

  await bottomNav.getByRole("button", { name: "Noodle notifications" }).click();
  await expect(noodle.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(bottomNav).toBeVisible();
  await noodle.getByRole("button", { name: "Back to Noodle timeline" }).click();
  await expect(header).toBeVisible();

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
