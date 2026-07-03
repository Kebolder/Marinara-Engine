import type {
  GeminiOmniVideoDefaults,
  VideoAspectRatio,
  VideoDefaultsService,
  VideoGenerationDefaultsProfile,
  VideoResolution,
  XaiVideoDefaults,
} from "../types/video-generation-defaults.js";

export const VIDEO_DEFAULTS_STORAGE_KEY = "videoGeneration";
export const VIDEO_GENERATION_DEFAULTS_VERSION = 1 as const;

export const VIDEO_DEFAULTS_SERVICES: VideoDefaultsService[] = ["gemini_omni", "xai"];

export const DEFAULT_GEMINI_OMNI_VIDEO_DEFAULTS: GeminiOmniVideoDefaults = {
  durationSeconds: 10,
  aspectRatio: "16:9",
};

export const DEFAULT_XAI_VIDEO_DEFAULTS: XaiVideoDefaults = {
  durationSeconds: 10,
  aspectRatio: "16:9",
  resolution: "720p",
};

export function createDefaultVideoGenerationProfile(
  service: VideoDefaultsService = "gemini_omni",
): VideoGenerationDefaultsProfile {
  return {
    version: VIDEO_GENERATION_DEFAULTS_VERSION,
    service,
    geminiOmni: { ...DEFAULT_GEMINI_OMNI_VIDEO_DEFAULTS },
    xai: { ...DEFAULT_XAI_VIDEO_DEFAULTS },
  };
}

export function normalizeVideoGenerationProfile(rawProfile: unknown): {
  profile: VideoGenerationDefaultsProfile;
  changed: boolean;
} {
  const profile = createDefaultVideoGenerationProfile();
  const raw = isRecord(rawProfile) ? rawProfile : {};
  const rawService =
    raw.service === "xai" || raw.service === "gemini_omni" ? (raw.service as VideoDefaultsService) : "gemini_omni";
  profile.service = rawService;
  const rawOmni = isRecord(raw.geminiOmni) ? raw.geminiOmni : rawService === "gemini_omni" ? raw : {};
  profile.geminiOmni = {
    durationSeconds: readInteger(
      rawOmni.durationSeconds,
      DEFAULT_GEMINI_OMNI_VIDEO_DEFAULTS.durationSeconds,
      1,
      60,
    ),
    aspectRatio: readAspectRatio(rawOmni.aspectRatio, DEFAULT_GEMINI_OMNI_VIDEO_DEFAULTS.aspectRatio),
  };
  const rawXai = isRecord(raw.xai) ? raw.xai : rawService === "xai" ? raw : {};
  profile.xai = {
    durationSeconds: readInteger(rawXai.durationSeconds, DEFAULT_XAI_VIDEO_DEFAULTS.durationSeconds, 1, 15),
    aspectRatio: readAspectRatio(rawXai.aspectRatio, DEFAULT_XAI_VIDEO_DEFAULTS.aspectRatio),
    resolution: readResolution(rawXai.resolution, DEFAULT_XAI_VIDEO_DEFAULTS.resolution),
  };
  const changed = JSON.stringify(profile) !== JSON.stringify(rawProfile);
  return { profile, changed };
}

export function sanitizeVideoGenerationProfile(profile: VideoGenerationDefaultsProfile): VideoGenerationDefaultsProfile {
  return normalizeVideoGenerationProfile(profile).profile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.trunc(Math.min(max, Math.max(min, numeric)));
}

function readAspectRatio(value: unknown, fallback: VideoAspectRatio): VideoAspectRatio {
  return value === "9:16" || value === "16:9" ? value : fallback;
}

function readResolution(value: unknown, fallback: VideoResolution): VideoResolution {
  return value === "480p" || value === "720p" || value === "1080p" ? value : fallback;
}
