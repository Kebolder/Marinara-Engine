import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  CONVERSATION_CALL_CHARACTER_VIDEO_CLIP_KINDS,
  getConversationCallVideoClipDuration,
  normalizeVideoGenerationUserSettings,
  VIDEO_DEFAULTS_STORAGE_KEY,
  createDefaultVideoGenerationProfile,
  inferVideoSource,
  normalizeVideoGenerationProfile,
  type ConversationCallCharacterVideoClip,
  type ConversationCallCharacterVideoClipKind,
  type ConversationCallCharacterVideoManifest,
  type VideoGenerationUserSettings,
} from "@marinara-engine/shared";
import { logger, logDebugOverride } from "../../lib/logger.js";
import { DATA_DIR } from "../../utils/data-dir.js";
import { assertInsideDir, isAllowedImageBuffer } from "../../utils/security.js";
import {
  CONVERSATION_CALL_VIDEO_CLIP_INSTRUCTION_BY_KIND,
  CONVERSATION_CALL_VIDEO_CLIP_LABEL_BY_KIND,
  CONVERSATION_CALL_VIDEO_PROMPT_BY_KIND,
  loadPrompt,
} from "../prompt-overrides/index.js";
import type { PromptOverridesStorage } from "../storage/prompt-overrides.storage.js";
import { generateVideo, type VideoReferenceImage } from "../video/video-generation.js";

type DiskClip = {
  status?: ConversationCallCharacterVideoClip["status"];
  error?: string | null;
  updatedAt?: string | null;
};

type DiskManifest = {
  version: 1;
  characterId: string;
  characterName: string;
  sourceAvatarPath: string | null;
  updatedAt: string | null;
  clips: Partial<Record<ConversationCallCharacterVideoClipKind, DiskClip>>;
};

type VideoGenerationConnection = {
  id: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  model?: string | null;
  videoGenerationSource?: string | null;
  videoService?: string | null;
  defaultParameters?: string | null;
};

const CALL_CHARACTER_VIDEO_ROOT = join(DATA_DIR, "conversation-call-character-videos");
const AVATARS_ROOT = join(DATA_DIR, "avatars");
const DEFAULT_GEMINI_OMNI_MODEL = "gemini-omni-flash-preview";
const DEFAULT_GEMINI_OMNI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_XAI_VIDEO_MODEL = "grok-imagine-video-1.5";
const DEFAULT_XAI_VIDEO_BASE_URL = "https://api.x.ai/v1";
const CALL_CHARACTER_VIDEO_VERSION = 1;
const GENERATION_LOCKS = new Map<string, Promise<void>>();

type SharpFn = (input: Buffer, options?: Record<string, unknown>) => {
  png: () => { toBuffer: () => Promise<Buffer> };
};

let sharpLoad: Promise<SharpFn> | null = null;

async function getSharp(): Promise<SharpFn> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - optional native dep, may not be installed on all supported platforms.
  sharpLoad ??= import("sharp").then((mod) => (mod.default ?? mod) as unknown as SharpFn);
  return sharpLoad;
}

function nowIso() {
  return new Date().toISOString();
}

function assertSafeCharacterId(characterId: string) {
  if (!characterId || characterId.includes("..") || characterId.includes("/") || characterId.includes("\\") || characterId.includes("\0")) {
    throw new Error("Invalid character id");
  }
  return characterId;
}

function characterDir(characterId: string) {
  return assertInsideDir(CALL_CHARACTER_VIDEO_ROOT, join(CALL_CHARACTER_VIDEO_ROOT, assertSafeCharacterId(characterId)));
}

function manifestPath(characterId: string) {
  return assertInsideDir(CALL_CHARACTER_VIDEO_ROOT, join(characterDir(characterId), "manifest.json"));
}

function clipPath(characterId: string, kind: ConversationCallCharacterVideoClipKind) {
  return assertInsideDir(CALL_CHARACTER_VIDEO_ROOT, join(characterDir(characterId), `${kind}.mp4`));
}

function clipUrl(characterId: string, kind: ConversationCallCharacterVideoClipKind) {
  return `/api/conversation-calls/character-videos/${encodeURIComponent(characterId)}/file/${encodeURIComponent(kind)}`;
}

function blankManifest(characterId: string, characterName: string, sourceAvatarPath: string | null): DiskManifest {
  return {
    version: CALL_CHARACTER_VIDEO_VERSION,
    characterId,
    characterName,
    sourceAvatarPath,
    updatedAt: null,
    clips: {},
  };
}

async function readDiskManifest(
  characterId: string,
  characterName: string,
  sourceAvatarPath: string | null,
): Promise<DiskManifest> {
  const fallback = blankManifest(characterId, characterName, sourceAvatarPath);
  try {
    const raw = await readFile(manifestPath(characterId), "utf8");
    const parsed = JSON.parse(raw) as Partial<DiskManifest>;
    return {
      ...fallback,
      ...parsed,
      version: CALL_CHARACTER_VIDEO_VERSION,
      characterId,
      characterName,
      sourceAvatarPath: parsed.sourceAvatarPath ?? sourceAvatarPath,
      clips: parsed.clips && typeof parsed.clips === "object" ? parsed.clips : {},
    };
  } catch {
    return fallback;
  }
}

async function writeDiskManifest(manifest: DiskManifest) {
  const dir = characterDir(manifest.characterId);
  await mkdir(dir, { recursive: true });
  const file = manifestPath(manifest.characterId);
  const tmp = assertInsideDir(CALL_CHARACTER_VIDEO_ROOT, `${file}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, JSON.stringify(manifest, null, 2), "utf8");
  await rename(tmp, file);
}

function toPublicManifest(manifest: DiskManifest): ConversationCallCharacterVideoManifest {
  const generating = GENERATION_LOCKS.has(manifest.characterId);
  const clips = CONVERSATION_CALL_CHARACTER_VIDEO_CLIP_KINDS.map((kind): ConversationCallCharacterVideoClip => {
    const disk = manifest.clips[kind] ?? {};
    const fileExists = existsSync(clipPath(manifest.characterId, kind));
    const status = fileExists
      ? "ready"
      : disk.status === "error"
        ? "error"
        : disk.status === "generating" && generating
          ? "generating"
          : "missing";
    return {
      kind,
      status,
      url: status === "ready" ? clipUrl(manifest.characterId, kind) : null,
      error: status === "error" ? (disk.error ?? "Video generation failed") : null,
      updatedAt: disk.updatedAt ?? null,
    };
  });
  return {
    characterId: manifest.characterId,
    characterName: manifest.characterName,
    sourceAvatarPath: manifest.sourceAvatarPath,
    generating,
    updatedAt: manifest.updatedAt,
    clips,
  };
}

function parseDefaultParametersRoot(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  let parsed: unknown = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return {};
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? { ...(parsed as Record<string, unknown>) }
    : {};
}

function getStoredVideoDefaults(raw: unknown) {
  const root = parseDefaultParametersRoot(raw);
  return normalizeVideoGenerationProfile(root[VIDEO_DEFAULTS_STORAGE_KEY]).profile;
}

async function readAvatarReferenceImage(avatarPath: string | null): Promise<VideoReferenceImage> {
  if (!avatarPath) throw new Error("The character needs an avatar before Marinara can generate call videos.");
  const filename = avatarPath.split("?")[0]!.split("/").pop();
  if (!filename) throw new Error("The character avatar path is invalid.");
  const filepath = assertInsideDir(AVATARS_ROOT, join(AVATARS_ROOT, filename));
  if (!existsSync(filepath)) throw new Error("The character avatar file could not be found.");
  const buffer = await readFile(filepath);
  const imageInfo = isAllowedImageBuffer(buffer, extname(filename));
  if (!imageInfo) throw new Error("The character avatar is not a supported image file.");
  if (imageInfo.mimeType === "image/png" || imageInfo.mimeType === "image/jpeg") {
    return { base64: buffer.toString("base64"), mimeType: imageInfo.mimeType };
  }
  const sharp = await getSharp();
  const png = await sharp(buffer, { limitInputPixels: false }).png().toBuffer();
  return { base64: png.toString("base64"), mimeType: "image/png" };
}

function getClipLabel(kind: ConversationCallCharacterVideoClipKind) {
  return CONVERSATION_CALL_VIDEO_CLIP_LABEL_BY_KIND.get(kind) ?? `${kind} clip`;
}

function getClipInstruction(kind: ConversationCallCharacterVideoClipKind) {
  return (
    CONVERSATION_CALL_VIDEO_CLIP_INSTRUCTION_BY_KIND.get(kind) ??
    "Begin from neutral idle, animate naturally for the clip type, then settle fully back into neutral idle by the final frame."
  );
}

async function buildClipPrompt(input: {
  promptOverridesStorage: PromptOverridesStorage;
  characterName: string;
  kind: ConversationCallCharacterVideoClipKind;
  durationSeconds: number;
}) {
  const def = CONVERSATION_CALL_VIDEO_PROMPT_BY_KIND.get(input.kind);
  if (!def) {
    return [
      `Create a ${input.durationSeconds}-second 16:9 ${getClipLabel(input.kind)} for an AI character in a private video call.`,
      `Character name: ${input.characterName}.`,
      getClipInstruction(input.kind),
      "Use the supplied avatar as the exact identity and art style reference.",
      "Keep camera framing stable like a video-call participant tile. Preserve the avatar's face, hair, outfit cues, and art style.",
      "Single character only. No extra people. No UI, captions, subtitles, speech bubbles, text, logos, or watermarks.",
    ].join("\n");
  }
  return loadPrompt(input.promptOverridesStorage, def, {
    characterName: input.characterName,
    clipLabel: getClipLabel(input.kind),
    clipInstruction: getClipInstruction(input.kind),
    durationSeconds: input.durationSeconds,
    aspectRatio: "16:9",
  });
}

function resolveVideoConnection(connection: VideoGenerationConnection) {
  const videoDefaults = connection.defaultParameters
    ? getStoredVideoDefaults(connection.defaultParameters)
    : createDefaultVideoGenerationProfile();
  const explicitVideoSource = connection.videoGenerationSource || connection.videoService || "";
  const source =
    explicitVideoSource ||
    (videoDefaults.service === "xai"
      ? "xai"
      : inferVideoSource(connection.model || "", connection.baseUrl || ""));
  const serviceHint = connection.videoService || source;
  const isXaiVideo = source === "xai" || serviceHint === "xai";
  return {
    source,
    serviceHint,
    baseUrl: connection.baseUrl || (isXaiVideo ? DEFAULT_XAI_VIDEO_BASE_URL : DEFAULT_GEMINI_OMNI_BASE_URL),
    model: connection.model || (isXaiVideo ? DEFAULT_XAI_VIDEO_MODEL : DEFAULT_GEMINI_OMNI_MODEL),
    resolution: isXaiVideo ? videoDefaults.xai.resolution : undefined,
  };
}

async function runGenerationJob(input: {
  characterId: string;
  characterName: string;
  avatarPath: string | null;
  connection: VideoGenerationConnection;
  promptOverridesStorage: PromptOverridesStorage;
  videoSettings: VideoGenerationUserSettings;
  debugMode?: boolean;
}) {
  const startedAt = nowIso();
  let manifest = await readDiskManifest(input.characterId, input.characterName, input.avatarPath);
  const referenceImage = await readAvatarReferenceImage(input.avatarPath);
  const resolved = resolveVideoConnection(input.connection);
  logger.info(
    "[conversation-call/videos] Generating call videos for %s via connection=%s source=%s model=%s",
    input.characterId,
    input.connection.id,
    resolved.source,
    resolved.model,
  );

  for (const kind of CONVERSATION_CALL_CHARACTER_VIDEO_CLIP_KINDS) {
    const diskClip = manifest.clips[kind] ?? {};
    if (diskClip.status === "ready" && manifest.sourceAvatarPath === input.avatarPath && existsSync(clipPath(input.characterId, kind))) {
      continue;
    }
    const durationSeconds = getConversationCallVideoClipDuration(input.videoSettings, kind);
    const prompt = await buildClipPrompt({
      promptOverridesStorage: input.promptOverridesStorage,
      characterName: input.characterName,
      kind,
      durationSeconds,
    });
    try {
      if (input.debugMode) {
        logDebugOverride(true, "[debug/conversation-call/videos] %s prompt for %s:\n%s", kind, input.characterId, prompt);
      }
      const generated = await generateVideo(
        resolved.source,
        resolved.baseUrl,
        input.connection.apiKey || "",
        resolved.serviceHint,
        {
          prompt,
          model: resolved.model,
          durationSeconds,
          aspectRatio: "16:9",
          resolution: resolved.resolution,
          referenceImage,
        },
      );
      const file = clipPath(input.characterId, kind);
      const tmp = assertInsideDir(CALL_CHARACTER_VIDEO_ROOT, `${file}.${process.pid}.${Date.now()}.tmp`);
      await writeFile(tmp, Buffer.from(generated.base64, "base64"));
      await rename(tmp, file);
      manifest = {
        ...manifest,
        sourceAvatarPath: input.avatarPath,
        updatedAt: nowIso(),
        clips: {
          ...manifest.clips,
          [kind]: { status: "ready", error: null, updatedAt: nowIso() },
        },
      };
      await writeDiskManifest(manifest);
      logger.info("[conversation-call/videos] Generated %s for %s", getClipLabel(kind), input.characterId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video generation failed";
      manifest = {
        ...manifest,
        sourceAvatarPath: input.avatarPath,
        updatedAt: nowIso(),
        clips: {
          ...manifest.clips,
          [kind]: { status: "error", error: message, updatedAt: nowIso() },
        },
      };
      await writeDiskManifest(manifest);
      logger.warn(error, "[conversation-call/videos] Failed to generate %s for %s", kind, input.characterId);
    }
  }

  logger.info(
    "[conversation-call/videos] Finished call video generation for %s in %dms",
    input.characterId,
    Date.now() - Date.parse(startedAt),
  );
}

export async function getConversationCallCharacterVideoManifest(input: {
  characterId: string;
  characterName: string;
  avatarPath: string | null;
}): Promise<ConversationCallCharacterVideoManifest> {
  assertSafeCharacterId(input.characterId);
  const manifest = await readDiskManifest(input.characterId, input.characterName, input.avatarPath);
  return toPublicManifest(manifest);
}

export async function startConversationCallCharacterVideoGeneration(input: {
  characterId: string;
  characterName: string;
  avatarPath: string | null;
  connection: VideoGenerationConnection;
  promptOverridesStorage: PromptOverridesStorage;
  videoSettings?: VideoGenerationUserSettings | null;
  debugMode?: boolean;
}): Promise<ConversationCallCharacterVideoManifest> {
  assertSafeCharacterId(input.characterId);
  const videoSettings = normalizeVideoGenerationUserSettings(input.videoSettings);
  if (!GENERATION_LOCKS.has(input.characterId)) {
    const current = await readDiskManifest(input.characterId, input.characterName, input.avatarPath);
    const avatarChanged = current.sourceAvatarPath !== input.avatarPath;
    const timestamp = nowIso();
    const clips = { ...current.clips };
    for (const kind of CONVERSATION_CALL_CHARACTER_VIDEO_CLIP_KINDS) {
      const ready = !avatarChanged && existsSync(clipPath(input.characterId, kind)) && clips[kind]?.status === "ready";
      if (!ready) clips[kind] = { status: "generating", error: null, updatedAt: timestamp };
    }
    const pendingManifest: DiskManifest = {
      ...current,
      characterName: input.characterName,
      sourceAvatarPath: input.avatarPath,
      updatedAt: timestamp,
      clips,
    };
    await writeDiskManifest(pendingManifest);
    const job = runGenerationJob({ ...input, videoSettings }).finally(() => {
      GENERATION_LOCKS.delete(input.characterId);
    });
    GENERATION_LOCKS.set(input.characterId, job);
    void job.catch((error) => {
      logger.warn(error, "[conversation-call/videos] Call video generation job failed for %s", input.characterId);
    });
  }
  return getConversationCallCharacterVideoManifest(input);
}

export function getConversationCallCharacterVideoFile(characterId: string, kind: ConversationCallCharacterVideoClipKind) {
  assertSafeCharacterId(characterId);
  if (!CONVERSATION_CALL_CHARACTER_VIDEO_CLIP_KINDS.includes(kind)) return null;
  const file = clipPath(characterId, kind);
  return existsSync(file) ? file : null;
}
