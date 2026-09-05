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

// Both WebVTT and SRT delimit cue blocks with a blank line, so a blank line
// inside one cue's text — a hand-authored multi-paragraph beat, say — ends
// that block early and the parser reprocesses everything after it as a new
// block. A real parser (ffprobe) confirmed this: two cues in, one cue out,
// no error, with the second cue's timing and text gone entirely. A unit test
// on the string transformation alone would not catch a regression that
// reintroduces this — only counting surviving timing lines against the
// number of cues passed in would.
describe("blank lines inside cue text", () => {
  const timingLinePattern = /^\d{2}:\d{2}:\d{2}[.,]\d{3} --> \d{2}:\d{2}:\d{2}[.,]\d{3}$/;
  const cuesWithABlankLine: Cue[] = [
    { startSeconds: 0, endSeconds: 1, text: "First paragraph.\n\nSecond paragraph." },
    { startSeconds: 2, endSeconds: 3, text: "A second, unrelated cue." },
  ];

  it("still produces one VTT timing line per cue passed in", () => {
    const timingLines = formatVtt(cuesWithABlankLine)
      .split("\n")
      .filter((line) => timingLinePattern.test(line));
    expect(timingLines).toHaveLength(cuesWithABlankLine.length);
  });

  it("still produces one SRT timing line per cue passed in", () => {
    const timingLines = formatSrt(cuesWithABlankLine)
      .split("\n")
      .filter((line) => timingLinePattern.test(line));
    expect(timingLines).toHaveLength(cuesWithABlankLine.length);
  });

  it("keeps the non-blank lines of the split paragraph, just not the blank one", () => {
    expect(formatVtt(cuesWithABlankLine)).toContain(
      "First paragraph.\nSecond paragraph."
    );
  });
});

// Mermaid edge syntax ("A --> B") is ordinary narration content for this
// project, and per the WebVTT parsing algorithm a line containing "-->"
// while a cue's text is being collected ends that cue immediately — the
// substring is reprocessed as a timing line, fails, and is dropped. ffmpeg's
// parser is lenient about this, so it would not have caught the bug; the
// assertion below checks the actual output text rather than trusting ffmpeg.
describe("a literal --> inside cue text", () => {
  const cuesWithAnArrow: Cue[] = [
    { startSeconds: 0, endSeconds: 1, text: "The arrow from A to B, A --> B." },
    { startSeconds: 2, endSeconds: 3, text: "A second, unrelated cue." },
  ];

  it("escapes it out of VTT cue text so no line reads as a timing line", () => {
    const output = formatVtt(cuesWithAnArrow);
    expect(output).not.toContain("A --> B.");
    expect(output).toContain("A --&gt; B.");

    const timingLinePattern = /^\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}$/;
    const timingLines = output.split("\n").filter((line) => timingLinePattern.test(line));
    expect(timingLines).toHaveLength(cuesWithAnArrow.length);
  });
});

// WebVTT cue text is a tag language: an unescaped "<" or "&" is read as the
// start of a tag or character reference, and "<track>" — an ordinary phrase
// for a project that narrates web APIs — silently vanishes from what a
// viewer reads. SRT has no such tag language, so escaping it there would
// corrupt plain text instead of protecting it.
describe("< and & in cue text", () => {
  const cues: Cue[] = [
    { startSeconds: 0, endSeconds: 1, text: "Use the <track> element & the src attr." },
  ];

  it("escapes them for VTT", () => {
    expect(formatVtt(cues)).toContain(
      "Use the &lt;track&gt; element &amp; the src attr."
    );
  });

  it("leaves them alone for SRT, which has no entity escaping", () => {
    expect(formatSrt(cues)).toContain(
      "Use the <track> element & the src attr."
    );
  });
});
