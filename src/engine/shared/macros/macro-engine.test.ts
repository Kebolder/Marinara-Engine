import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMacros, type MacroContext } from "./macro-engine";
import { formatZonedDate, formatZonedTime, getZonedWeekdayName } from "../time/timezone";

function baseContext(overrides: Partial<MacroContext> = {}): MacroContext {
  return {
    user: "User",
    char: "Char",
    characters: ["Char"],
    variables: {},
    ...overrides,
  };
}

describe("resolveMacros time macros", () => {
  // Use a moment that lands on different calendar days in UTC vs. Pacific time:
  // 2026-05-27T05:30:00Z is 2026-05-26 22:30 in America/Los_Angeles.
  const fixed = new Date("2026-05-27T05:30:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixed);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("{{date}} honors caller-provided IANA timezone", () => {
    const ctx = baseContext({ timeZone: "America/Los_Angeles" });
    expect(resolveMacros("{{date}}", ctx)).toBe("2026-05-26");
  });

  it("{{time}} honors caller-provided IANA timezone", () => {
    const ctx = baseContext({ timeZone: "America/Los_Angeles" });
    expect(resolveMacros("{{time}}", ctx)).toBe("22:30");
  });

  it("{{weekday}} honors caller-provided IANA timezone", () => {
    // 2026-05-26 in LA is a Tuesday; UTC instant lands on Wednesday.
    const ctx = baseContext({ timeZone: "America/Los_Angeles" });
    expect(resolveMacros("{{weekday}}", ctx)).toBe("Tuesday");
  });

  it("{{datetime}} produces a zoned offset rather than a UTC Z stamp", () => {
    const ctx = baseContext({ timeZone: "America/Los_Angeles" });
    const datetime = resolveMacros("{{datetime}}", ctx);
    expect(datetime.startsWith("2026-05-26T22:30:")).toBe(true);
    expect(datetime).not.toMatch(/Z$/);
  });

  it("falls back to host-local resolution when no timezone is provided", () => {
    const ctx = baseContext();
    // Without a timezone we must match the helper's host-local rendering;
    // do not assume UTC.
    expect(resolveMacros("{{date}}", ctx)).toBe(formatZonedDate(fixed));
    expect(resolveMacros("{{time}}", ctx)).toBe(formatZonedTime(fixed));
    expect(resolveMacros("{{weekday}}", ctx)).toBe(getZonedWeekdayName(fixed));
  });

  it("{{datetime}} also falls back to host-local rather than UTC when no timezone is provided", () => {
    const ctx = baseContext();
    const datetime = resolveMacros("{{datetime}}", ctx);
    // Pre-fix-pass 2 this returned `Date.toISOString()` (UTC, ends in `Z`),
    // splitting {{datetime}} away from {{date}}/{{time}} for any caller that
    // skipped the input plumbing. Post-fix it emits a numeric offset and
    // never the UTC Z stamp.
    expect(datetime).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(datetime).not.toMatch(/Z$/);
  });
});
