// ──────────────────────────────────────────────
// Routes: Chat Backgrounds (upload, list, delete, serve, tags, rename)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { existsSync, mkdirSync, readdirSync, unlinkSync, readFileSync, writeFileSync, renameSync } from "fs";
import { writeFile } from "fs/promises";
import { join, extname, basename, parse as parsePath } from "path";
import { z } from "zod";
import { DATA_DIR } from "../utils/data-dir.js";
import { logDebugOverride } from "../lib/logger.js";
import { isDebugAgentsEnabled } from "../config/runtime-config.js";
import { buildAssetManifest, getAssetManifest } from "../services/game/asset-manifest.service.js";
import { assertInsideDir, isAllowedImageBuffer } from "../utils/security.js";
import { createAgentsStorage } from "../services/storage/agents.storage.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createGameStateStorage } from "../services/storage/game-state.storage.js";
import { createPromptOverridesStorage } from "../services/storage/prompt-overrides.storage.js";
import { generateChatBackground } from "../services/game/game-asset-generation.js";
import { resolveConnectionImageDefaults } from "../services/image/image-generation-defaults.js";
import { loadImageGenerationUserSettings } from "../services/image/image-generation-settings.js";

const BG_DIR = join(DATA_DIR, "backgrounds");
const META_PATH = join(BG_DIR, "meta.json");

// Ensure directory exists
function ensureDir() {
  if (!existsSync(BG_DIR)) {
    mkdirSync(BG_DIR, { recursive: true });
  }
}

interface BgMeta {
  originalName?: string;
  tags: string[];
}
type MetaMap = Record<string, BgMeta>;

function readMeta(): MetaMap {
  ensureDir();
  if (!existsSync(META_PATH)) return {};
  try {
    return JSON.parse(readFileSync(META_PATH, "utf-8")) as MetaMap;
  } catch {
    return {};
  }
}

function writeMeta(meta: MetaMap) {
  ensureDir();
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2), "utf-8");
}

const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const BACKGROUND_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const SCENE_BACKGROUND_MODES = new Set(["roleplay", "visual_novel", "game"]);

const generateSceneBackgroundSchema = z.object({
  chatId: z.string().min(1),
  sceneDescription: z.string().min(1).max(1200),
  locationSlug: z.string().max(180).optional(),
  reason: z.string().max(300).optional(),
  debugMode: z.boolean().optional().default(false),
});

/** Sanitise a filename: keep alphanumeric, spaces, hyphens, underscores, dots. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9 _.\-]/g, "").trim();
}

/** Given a desired filename, return a unique filename that doesn't collide with existing files. */
function uniqueFilename(desired: string): string {
  if (!existsSync(join(BG_DIR, desired))) return desired;
  const { name, ext } = parsePath(desired);
  let i = 2;
  while (existsSync(join(BG_DIR, `${name}_${i}${ext}`))) i++;
  return `${name}_${i}${ext}`;
}

function encodeAssetPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function readAgentImageConnectionId(
  agents: ReturnType<typeof createAgentsStorage>,
  type: "background" | "illustrator",
): Promise<string | null> {
  const agent = await agents.getByType(type);
  return readTrimmedString(parseRecord(agent?.settings).imageConnectionId);
}

async function resolveSceneBackgroundImageConnection(
  connections: ReturnType<typeof createConnectionsStorage>,
  agents: ReturnType<typeof createAgentsStorage>,
  mode: string,
  metadata: Record<string, unknown>,
) {
  const candidates: string[] = [];
  const pushCandidate = (id: string | null) => {
    if (id && !candidates.includes(id)) candidates.push(id);
  };

  if (mode === "game") {
    pushCandidate(readTrimmedString(metadata.gameImageConnectionId));
    pushCandidate(await readAgentImageConnectionId(agents, "illustrator"));
  } else {
    pushCandidate(await readAgentImageConnectionId(agents, "background"));
    pushCandidate(await readAgentImageConnectionId(agents, "illustrator"));
  }

  for (const id of candidates) {
    const conn = await connections.getWithKey(id);
    if (conn?.provider === "image_generation") return conn;
  }

  return connections.getDefaultForImageGeneration();
}

function backgroundTagForFilename(filename: string): string {
  return `backgrounds:user:${parsePath(filename).name}`;
}

export async function backgroundsRoutes(app: FastifyInstance) {
  // List all backgrounds (includes tags)
  app.get("/", async () => {
    ensureDir();
    const meta = readMeta();
    const files = readdirSync(BG_DIR).filter((f) => {
      const ext = extname(f).toLowerCase();
      return ALLOWED_EXTS.has(ext);
    });
    const userBackgrounds = files.map((filename) => ({
      id: `user:${filename}`,
      filename,
      url: `/api/backgrounds/file/${encodeURIComponent(filename)}`,
      originalName: meta[filename]?.originalName ?? null,
      tags: meta[filename]?.tags ?? [],
      source: "user" as const,
      editable: true,
      deletable: true,
      renameable: true,
    }));

    const gameAssetBackgrounds = (getAssetManifest().byCategory.backgrounds ?? [])
      .filter((entry) => !entry.path.startsWith("__user_bg__/"))
      .map((entry) => ({
        id: `game:${entry.tag}`,
        filename: `${entry.name}${entry.ext}`,
        url: `/api/game-assets/file/${encodeAssetPath(entry.path)}`,
        originalName: entry.tag,
        tags: entry.subcategory ? [entry.subcategory] : [],
        source: "game_asset" as const,
        tag: entry.tag,
        editable: false,
        deletable: false,
        renameable: false,
      }));

    return [...userBackgrounds, ...gameAssetBackgrounds];
  });

  // List all unique tags (for autocomplete)
  app.get("/tags", async () => {
    const meta = readMeta();
    const tagSet = new Set<string>();
    for (const entry of Object.values(meta)) {
      for (const t of entry.tags) tagSet.add(t);
    }
    return [...tagSet].sort();
  });

  // Upload a new background (preserves original filename)
  app.post("/upload", async (req, reply) => {
    ensureDir();
    const data = await req.file({ limits: { fileSize: BACKGROUND_UPLOAD_MAX_BYTES } });
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const ext = extname(data.filename).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      return reply.status(400).send({ error: `Unsupported file type: ${ext}` });
    }

    // Use the original filename (sanitised) instead of a UUID
    const sanitized = sanitizeFilename(basename(data.filename));
    const safeName = sanitized ? uniqueFilename(sanitized) : uniqueFilename(`background${ext}`);
    const filePath = assertInsideDir(BG_DIR, join(BG_DIR, safeName));
    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.status(413).send({ error: "Background image is too large" });
      }
      throw err;
    }
    if (!isAllowedImageBuffer(buffer, ext)) {
      return reply.status(400).send({ error: "Unsupported or invalid image file" });
    }
    await writeFile(filePath, buffer);

    // Store metadata
    const meta = readMeta();
    meta[safeName] = { originalName: data.filename, tags: [] };
    writeMeta(meta);

    // Rebuild game asset manifest so scene analysis picks up new backgrounds
    buildAssetManifest();

    return {
      success: true,
      filename: safeName,
      originalName: data.filename,
      url: `/api/backgrounds/file/${encodeURIComponent(safeName)}`,
      tags: [],
    };
  });

  app.post("/generate-scene", async (req, reply) => {
    const input = generateSceneBackgroundSchema.parse(req.body);
    const debugOverrideEnabled = input.debugMode === true || isDebugAgentsEnabled();
    const debugLog = (message: string, ...args: any[]) => {
      logDebugOverride(debugOverrideEnabled, message, ...args);
    };
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(input.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });

    const mode = String(chat.mode ?? "");
    if (!SCENE_BACKGROUND_MODES.has(mode)) {
      return reply.status(400).send({ error: "Scene background generation is available in Roleplay and Game modes." });
    }

    const metadata = parseRecord(chat.metadata);
    const connections = createConnectionsStorage(app.db);
    const agents = createAgentsStorage(app.db);
    const imgConn = await resolveSceneBackgroundImageConnection(connections, agents, mode, metadata);
    if (!imgConn) {
      return reply.status(400).send({
        error:
          "Choose an image generation connection for the Background/Illustrator agent, or mark an image generation connection as the default for agents.",
      });
    }

    const setupConfig = parseRecord(metadata.gameSetupConfig);
    const gameState =
      mode === "game"
        ? await createGameStateStorage(app.db)
            .getLatest(input.chatId)
            .catch(() => null)
        : null;
    const imageSettings = await loadImageGenerationUserSettings(app.db);
    const styleProfileId =
      readTrimmedString(setupConfig.imageStyleProfileId) ?? readTrimmedString(metadata.imageStyleProfileId);
    const filename = await generateChatBackground({
      chatId: input.chatId,
      locationSlug: input.locationSlug?.trim() || input.reason?.trim() || chat.name || "current-scene",
      sceneDescription: input.sceneDescription.trim(),
      genre: readTrimmedString(setupConfig.genre) ?? undefined,
      setting: readTrimmedString(setupConfig.setting) ?? undefined,
      currentLocation: gameState?.location ?? null,
      currentWeather: gameState?.weather ?? null,
      currentTimeOfDay: gameState?.time ?? null,
      worldOverview: readTrimmedString(metadata.gameWorldOverview),
      artStyle: readTrimmedString(setupConfig.artStylePrompt) ?? undefined,
      reason: input.reason?.trim() || "Manual Gallery background request",
      sourceMode: mode === "game" ? "game" : mode === "visual_novel" ? "visual_novel" : "roleplay",
      imgModel: imgConn.model || "",
      imgBaseUrl: imgConn.baseUrl || "https://image.pollinations.ai",
      imgApiKey: imgConn.apiKey || "",
      imgSource: (imgConn as any).imageGenerationSource || imgConn.model || "",
      imgService: imgConn.imageService || (imgConn as any).imageGenerationSource || "",
      imgEndpointId: imgConn.imageEndpointId || undefined,
      imgComfyWorkflow: imgConn.comfyuiWorkflow || undefined,
      imgDefaults: resolveConnectionImageDefaults(imgConn),
      styleProfiles: imageSettings.styleProfiles,
      styleProfileId,
      debugLog,
      promptOverridesStorage: createPromptOverridesStorage(app.db),
      size: imageSettings.background,
    });

    if (!filename) {
      return reply.status(500).send({ error: "Background image generation failed. Check the image connection." });
    }

    const url = `/api/backgrounds/file/${encodeURIComponent(filename)}`;
    return {
      success: true,
      filename,
      url,
      tag: backgroundTagForFilename(filename),
    };
  });

  // Set tags for a background
  app.patch("/:filename/tags", async (req, reply) => {
    const { filename } = req.params as { filename: string };
    if (filename.includes("..") || filename.includes("/")) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    const filePath = assertInsideDir(BG_DIR, join(BG_DIR, filename));
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    const body = req.body as { tags?: string[] };
    if (!Array.isArray(body?.tags)) {
      return reply.status(400).send({ error: "tags must be an array of strings" });
    }

    // Sanitise: lowercase, trim, unique, limit length
    const tags = [
      ...new Set(
        body.tags
          .map((t: unknown) =>
            String(t)
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9 _-]/g, ""),
          )
          .filter((t) => t.length > 0 && t.length <= 40),
      ),
    ];

    const meta = readMeta();
    if (!meta[filename]) meta[filename] = { tags: [] };
    meta[filename].tags = tags;
    writeMeta(meta);

    return { success: true, tags };
  });

  // Rename a background file
  app.patch("/:filename/rename", async (req, reply) => {
    const { filename } = req.params as { filename: string };
    if (filename.includes("..") || filename.includes("/")) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    const filePath = assertInsideDir(BG_DIR, join(BG_DIR, filename));
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    const body = req.body as { name?: string };
    if (!body?.name || typeof body.name !== "string") {
      return reply.status(400).send({ error: "name is required" });
    }

    // Keep the existing extension
    const ext = extname(filename).toLowerCase();
    const rawName = sanitizeFilename(body.name.replace(/\.[^.]+$/, "")); // strip any extension they included
    if (!rawName) {
      return reply.status(400).send({ error: "Name is empty after sanitisation" });
    }

    const desired = `${rawName}${ext}`;
    if (desired === filename) {
      return { success: true, filename, url: `/api/backgrounds/file/${encodeURIComponent(filename)}` };
    }

    const newFilename = uniqueFilename(desired);
    const newPath = assertInsideDir(BG_DIR, join(BG_DIR, newFilename));

    renameSync(filePath, newPath);

    // Move metadata entry
    const meta = readMeta();
    if (meta[filename]) {
      meta[newFilename] = meta[filename];
      delete meta[filename];
    }
    writeMeta(meta);

    // Rebuild game asset manifest
    buildAssetManifest();

    return {
      success: true,
      oldFilename: filename,
      filename: newFilename,
      url: `/api/backgrounds/file/${encodeURIComponent(newFilename)}`,
    };
  });

  // Serve a background file
  app.get("/file/:filename", async (req, reply) => {
    ensureDir();
    const { filename } = req.params as { filename: string };

    // Prevent path traversal
    if (filename.includes("..") || filename.includes("/")) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    const filePath = assertInsideDir(BG_DIR, join(BG_DIR, filename));
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    const ext = extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".avif": "image/avif",
    };

    const { createReadStream } = await import("fs");
    const stream = createReadStream(filePath);
    return reply
      .header("Content-Type", mimeMap[ext] ?? "application/octet-stream")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(stream);
  });

  // Delete a background
  app.delete("/:filename", async (req, reply) => {
    ensureDir();
    const { filename } = req.params as { filename: string };

    if (filename.includes("..") || filename.includes("/")) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    const filePath = assertInsideDir(BG_DIR, join(BG_DIR, filename));
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    unlinkSync(filePath);

    // Remove from metadata
    const meta = readMeta();
    delete meta[filename];
    writeMeta(meta);

    // Rebuild game asset manifest
    buildAssetManifest();

    return { success: true };
  });
}
