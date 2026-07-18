import {
  noodleGeneratedProfileSchema,
  noodleGeneratedProfilesSchema,
  type NoodleGeneratedProfile,
} from "@marinara-engine/shared";

export type RejectedNoodleGeneratedProfile = {
  index: number;
  issueCount: number;
};

/**
 * Parse model-generated profile rows independently so one malformed account
 * cannot discard valid profiles from the same Noodle setup batch.
 */
export function parseNoodleGeneratedProfiles(value: unknown): {
  profiles: NoodleGeneratedProfile[];
  rejected: RejectedNoodleGeneratedProfile[];
} {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const rawProfiles = record?.profiles;
  if (!Array.isArray(rawProfiles)) {
    // Preserve the useful top-level validation error for a wholly malformed
    // response. Only individual profile failures are recoverable.
    noodleGeneratedProfilesSchema.parse(value);
    return { profiles: [], rejected: [] };
  }

  const profiles: NoodleGeneratedProfile[] = [];
  const rejected: RejectedNoodleGeneratedProfile[] = [];
  rawProfiles.forEach((rawProfile, index) => {
    const parsed = noodleGeneratedProfileSchema.safeParse(rawProfile);
    if (parsed.success) profiles.push(parsed.data);
    else rejected.push({ index, issueCount: parsed.error.issues.length });
  });
  return { profiles, rejected };
}
