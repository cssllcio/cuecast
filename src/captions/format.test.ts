import { describe, expect, it } from "vitest";
import type { Cue } from "./cues.js";
import { formatSrt, formatVtt } from "./format.js";

const cues: Cue[] = [
  { startSeconds: 0, endSeconds: 1.86, text: "The API talks to it." },
  { startSeconds: 2.86, endSeconds: 5.28, text: "It writes through SQL." },
];

describe("formatVtt", () => {
  it("writes a WEBVTT header and one cue per entry", () => {
    expect(formatVtt(cues)).toBe(
      [
        "WEBVTT",
        "",
        "00:00:00.000 --> 00:00:01.860",
        "The API talks to it.",
        "",
        "00:00:02.860 --> 00:00:05.280",
        "It writes through SQL.",
        "",
      ].join("\n")
    );
  });

  // An empty track is still a valid VTT file; a consumer that loads it should
  // see no cues rather than a parse error.
  it("still writes the header with no cues", () => {
    expect(formatVtt([])).toBe("WEBVTT\n");
  });
});

describe("formatSrt", () => {
  // SRT differs from VTT in exactly three ways: no header, 1-based indices,
  // and a comma before the milliseconds.
  it("numbers cues from one and separates milliseconds with a comma", () => {
    expect(formatSrt(cues)).toBe(
      [
        "1",
        "00:00:00,000 --> 00:00:01,860",
        "The API talks to it.",
        "",
        "2",
        "00:00:02,860 --> 00:00:05,280",
        "It writes through SQL.",
        "",
      ].join("\n")
    );
  });

  it("is empty with no cues", () => {
    expect(formatSrt([])).toBe("");
  });
});

describe("timestamps", () => {
  it("pads hours, minutes, seconds and milliseconds", () => {
    const at = (seconds: number) =>
      formatVtt([{ startSeconds: seconds, endSeconds: seconds, text: "x" }])
        .split("\n")[2]
        .split(" --> ")[0];

    expect(at(0)).toBe("00:00:00.000");
    expect(at(0.5)).toBe("00:00:00.500");
    expect(at(59.999)).toBe("00:00:59.999");
    expect(at(60)).toBe("00:01:00.000");
    expect(at(61.5)).toBe("00:01:01.500");
    expect(at(3599.999)).toBe("00:59:59.999");
    expect(at(3600)).toBe("01:00:00.000");
    expect(at(3661.25)).toBe("01:01:01.250");
  });

  // buildTimingTrack accumulates `cursorSeconds = entry.endSeconds`, so real
  // spans arrive as sums of floats. Truncating this one gives 8699 — an
  // off-by-a-millisecond that only shows up on certain values.
  it("rounds to the nearest millisecond rather than truncating", () => {
    const at = (seconds: number) =>
      formatVtt([{ startSeconds: seconds, endSeconds: seconds, text: "x" }])
        .split("\n")[2]
        .split(" --> ")[0];

    expect(at(8.699999999999998)).toBe("00:00:08.700");
    expect(at(2.8600000000000003)).toBe("00:00:02.860");
  });
});
