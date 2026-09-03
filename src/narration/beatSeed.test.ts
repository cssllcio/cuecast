import { describe, expect, it } from "vitest";
import type { NarrationBeat } from "../schema/videoScript.js";
import { beatSeed, resolveBeatSeed } from "./beatSeed.js";

const narrationBeat: NarrationBeat = {
  id: "beat_01",
  type: "narration",
  text: "The API talks to the database.",
  spoken: "The A P I talks to the database.",
};

describe("beatSeed", () => {
  // These values are a compatibility surface, not an implementation detail.
  // Every render ever made is reproducible only while they hold. If a change
  // to beatSeed breaks this test, the correct response is to revert the
  // change, not to update the numbers.
  it("returns known values for known inputs", () => {
    expect(beatSeed("example_video", "beat_01")).toBe(1815404907);
    expect(beatSeed("example_video", "beat_03")).toBe(1848960145);
    expect(beatSeed("other_video", "beat_01")).toBe(1351394639);
    expect(beatSeed("render_proof", "beat_01")).toBe(1397914454);
  });

  it("is deterministic", () => {
    expect(beatSeed("example_video", "beat_01")).toBe(
      beatSeed("example_video", "beat_01")
    );
  });

  it("gives different beats different seeds", () => {
    expect(beatSeed("example_video", "beat_01")).not.toBe(
      beatSeed("example_video", "beat_03")
    );
  });

  // The same beat id in two videos must not draw the same audio — the same
  // reasoning that made publicAudioPath namespace by video id in PR #8.
  it("gives the same beat id in different videos different seeds", () => {
    expect(beatSeed("example_video", "beat_01")).not.toBe(
      beatSeed("other_video", "beat_01")
    );
  });

  // Beat ids are unvalidated strings, so a printable separator would collide:
  // under a space, ("a b","c") and ("a","b c") both key to "a b c".
  it("does not collide when an id contains the separator's printable cousin", () => {
    expect(beatSeed("a b", "c")).not.toBe(beatSeed("a", "b c"));
  });

  // Voicebox rejects a negative seed with HTTP 422, and its schema caps
  // nothing above, so staying inside signed 32-bit is the safe range.
  it("always returns a non-negative integer below 2^31", () => {
    for (const id of ["a", "beat_01", "x".repeat(200), "unicode-é"]) {
      const seed = beatSeed("video", id);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 31);
    }
  });
});

describe("resolveBeatSeed", () => {
  it("falls back to the derived identity seed when the beat has no authored seed", () => {
    expect(resolveBeatSeed(narrationBeat, "example_video")).toBe(
      beatSeed("example_video", "beat_01")
    );
  });

  it("uses the authored seed when present", () => {
    expect(resolveBeatSeed({ ...narrationBeat, seed: 4000 }, "example_video")).toBe(4000);
  });

  // `beat.seed ?? beatSeed(...)` and `beat.seed || beatSeed(...)` type-check
  // identically and pass every other test, but `||` silently discards an
  // authored seed of exactly 0 and substitutes the derived one instead — the
  // same bug shape as the dead-lexicon `beat.spoken || applyLexicon(...)` bug
  // (design §5). This is the test that would catch a `??` -> `||` regression.
  it("keeps an authored seed of 0 rather than falling back to the derived seed", () => {
    expect(resolveBeatSeed({ ...narrationBeat, seed: 0 }, "example_video")).toBe(0);
  });
});
