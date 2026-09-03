import { describe, expect, it } from "vitest";
import { DEFAULT_DURATION_SECONDS, timelineDurationSeconds } from "./timelineDuration.js";

describe("timelineDurationSeconds", () => {
  it("takes the max end over all entries, not the last one in array order", () => {
    const timing = [
      { beatId: "beat_01", startSeconds: 0, endSeconds: 2 },
      // A bed that floats over the spine and ends before it, but sits last
      // in array order — the case that made `timing.at(-1)` wrong.
      { beatId: "music", startSeconds: 0, endSeconds: 2 },
    ];

    expect(timelineDurationSeconds(timing)).toBe(2);
  });

  it("falls back to the default for an empty timing array", () => {
    expect(timelineDurationSeconds([])).toBe(DEFAULT_DURATION_SECONDS);
  });

  // A bed-only script: every beat is a bed, none advances the cursor, so the
  // spine is empty and every bed clamps to {start: 0, end: 0}. Without the
  // fallback this hands Remotion a zero-length composition.
  it("falls back to the default when a bed-only script clamps every entry to zero", () => {
    const timing = [
      { beatId: "music", startSeconds: 0, endSeconds: 0 },
      { beatId: "sting", startSeconds: 0, endSeconds: 0 },
    ];

    expect(timelineDurationSeconds(timing)).toBe(DEFAULT_DURATION_SECONDS);
  });

  it("does not fall back when the real max end is positive", () => {
    const timing = [{ beatId: "beat_01", startSeconds: 0, endSeconds: 12.5 }];

    expect(timelineDurationSeconds(timing)).toBe(12.5);
  });
});
