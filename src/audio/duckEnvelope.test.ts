import { describe, expect, it } from "vitest";
import { buildDuckEnvelope, DUCK_RAMP_SECONDS } from "./duckEnvelope.js";

const BED_START = 0;

describe("buildDuckEnvelope", () => {
  it("is flat at full gain when nothing ducks the bed", () => {
    const gain = buildDuckEnvelope(BED_START, [], 0.25);
    for (const t of [0, 5, 10]) expect(gain(t)).toBe(1);
  });

  it("ramps down into a duck span, holds, and ramps back up", () => {
    const gain = buildDuckEnvelope(BED_START, [{ startSeconds: 2, endSeconds: 4 }], 0.25);

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
      BED_START,
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
      BED_START,
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

  // This does NOT exercise a ramp bleeding across the bed's own boundary —
  // see the next test for that. It only pins that `seconds` is computed as
  // `bedStartSeconds + secondsIntoBed`: the sample point (bed start 3,
  // secondsIntoBed 0) lands at seconds=3, which sits inside the span's hold
  // region [2, 4], so a wrong offset would still coincidentally read
  // `duckTo` here unless checked against the right absolute second.
  it("evaluates seconds as bedStartSeconds + secondsIntoBed, not secondsIntoBed alone", () => {
    const gain = buildDuckEnvelope(3, [{ startSeconds: 2, endSeconds: 4 }], 0.25);

    expect(gain(0)).toBeCloseTo(0.25, 6);
  });

  // The real bleed case: a bed placed immediately after the beat it ducks
  // starts fully ducked and ramps UP within the bed. The portion of the
  // release ramp that falls before the bed's own start (seconds 1.75-2) is
  // never sampled, but the portion inside the bed (seconds 2-2.25) is
  // sampled exactly like any other span's ramp — it does not "never sample".
  it("samples the in-bed portion of a ramp that started before the bed", () => {
    const gain = buildDuckEnvelope(2, [{ startSeconds: 0, endSeconds: 2 }], 0.1);

    expect(gain(0)).toBeCloseTo(0.1, 6);     // bed opens fully ducked
    expect(gain(0.125)).toBeCloseTo(0.55, 6); // halfway through the release
    expect(gain(0.25)).toBeCloseTo(1, 6);     // ramp finishes inside the bed
  });

  it("exposes the ramp as a constant rather than a magic number", () => {
    expect(DUCK_RAMP_SECONDS).toBeGreaterThan(0);
  });
});
