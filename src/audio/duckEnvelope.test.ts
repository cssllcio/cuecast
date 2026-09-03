import { describe, expect, it } from "vitest";
import { buildDuckEnvelope, DUCK_RAMP_SECONDS } from "./duckEnvelope.js";

const BED = { startSeconds: 0, endSeconds: 10 };

describe("buildDuckEnvelope", () => {
  it("is flat at full gain when nothing ducks the bed", () => {
    const gain = buildDuckEnvelope(BED, [], 0.25);
    for (const t of [0, 5, 10]) expect(gain(t)).toBe(1);
  });

  it("ramps down into a duck span, holds, and ramps back up", () => {
    const gain = buildDuckEnvelope(BED, [{ startSeconds: 2, endSeconds: 4 }], 0.25);

    expect(gain(0)).toBe(1);
    expect(gain(1.75)).toBe(1);      // ramp has not started
    expect(gain(1.875)).toBeCloseTo(0.625, 6); // halfway down
    expect(gain(2)).toBeCloseTo(0.25, 6);      // fully ducked
    expect(gain(3)).toBeCloseTo(0.25, 6);
    expect(gain(4)).toBeCloseTo(0.25, 6);
    expect(gain(4.125)).toBeCloseTo(0.625, 6); // halfway back
    expect(gain(4.25)).toBe(1);
    expect(gain(10)).toBe(1);
  });

  // Narration beats abut exactly, so two consecutively ducked beats must read
  // as ONE duck region. A per-span envelope applied sequentially would ramp
  // back to full in the zero-width gap and produce an audible blip.
  it("does not rise between two contiguous duck spans", () => {
    const gain = buildDuckEnvelope(
      BED,
      [
        { startSeconds: 2, endSeconds: 4 },
        { startSeconds: 4, endSeconds: 6 },
      ],
      0.25
    );

    for (const t of [3.9, 4, 4.1, 5, 6]) {
      expect(gain(t)).toBeCloseTo(0.25, 6);
    }
  });

  it("stays in range when two ramps cross", () => {
    // Gap of 0.2s, shorter than two ramps (2 x 0.25s), so the release of the
    // first overlaps the attack of the second.
    const gain = buildDuckEnvelope(
      BED,
      [
        { startSeconds: 2, endSeconds: 3 },
        { startSeconds: 3.2, endSeconds: 4 },
      ],
      0.25
    );

    expect(gain(3.1)).toBeCloseTo(0.55, 6);

    for (let t = 2.5; t <= 3.7; t += 0.01) {
      expect(gain(t)).toBeGreaterThanOrEqual(0.25);
      expect(gain(t)).toBeLessThanOrEqual(1);
    }
  });

  it("never samples a ramp that falls outside the bed", () => {
    // Bed starts at 3, inside a duck span that began at 2 — the attack ramp
    // sits before the bed exists and is simply never evaluated.
    const gain = buildDuckEnvelope(
      { startSeconds: 3, endSeconds: 10 },
      [{ startSeconds: 2, endSeconds: 4 }],
      0.25
    );

    expect(gain(0)).toBeCloseTo(0.25, 6);
  });

  it("exposes the ramp as a constant rather than a magic number", () => {
    expect(DUCK_RAMP_SECONDS).toBeGreaterThan(0);
  });
});
