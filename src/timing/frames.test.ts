import { describe, expect, it } from "vitest";
import { secondsToDurationFrames, secondsToFrame } from "./frames.js";

// Two conversions with deliberately different rounding:
//   secondsToFrame          -> a POSITION or SPAN on the timeline: nearest frame.
//   secondsToDurationFrames -> a composition's TOTAL length: never truncate
//                              the last partial frame of content.
describe("secondsToFrame (positions and spans: nearest frame)", () => {
  it("converts an exact frame multiple", () => {
    expect(secondsToFrame(2.4, 30)).toBe(72);
  });

  it("rounds a just-over value down to the nearest frame", () => {
    // 2.41s * 30 = 72.3 -> 72. Ceil here would start the beat a frame late.
    expect(secondsToFrame(2.41, 30)).toBe(72);
  });

  it("rounds a past-halfway value up", () => {
    // 2.42s * 30 = 72.6 -> 73
    expect(secondsToFrame(2.42, 30)).toBe(73);
  });

  it("maps a sub-half-frame value to frame 0", () => {
    expect(secondsToFrame(0.0166, 30)).toBe(0);
  });
});

describe("secondsToDurationFrames (total length: never truncate)", () => {
  it("converts an exact frame multiple", () => {
    expect(secondsToDurationFrames(2.4, 30)).toBe(72);
  });

  it("rounds a just-over value UP so the trailing content is not cut", () => {
    // 2.41s * 30 = 72.3 -> 73
    expect(secondsToDurationFrames(2.41, 30)).toBe(73);
  });

  it("reserves a whole frame for sub-frame content", () => {
    expect(secondsToDurationFrames(0.0166, 30)).toBe(1);
  });
});
