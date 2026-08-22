import { describe, expect, it } from "vitest";
import type { NarrationBeat, ScriptBeat } from "../schema/videoScript.js";
import { buildTimingTrack, extractBeatTiming } from "./timingExtractor.js";

const narrationBeat: NarrationBeat = {
  id: "beat_01",
  type: "narration",
  text: "The API talks to the database.",
  spoken: "The A P I talks to the database.",
};

describe("extractBeatTiming", () => {
  it("spans the beat's duration from the timeline offset", () => {
    const entry = extractBeatTiming(narrationBeat, 2.4, 5.0);

    expect(entry).toEqual({ beatId: "beat_01", startSeconds: 5.0, endSeconds: 7.4 });
  });
});

describe("buildTimingTrack", () => {
  it("lays out narration, silence, and bed beats sequentially from one durations map", () => {
    const beats: ScriptBeat[] = [
      narrationBeat,
      { id: "beat_02", type: "silence", duration: 1.5 },
      { id: "beat_03", type: "bed", audio: "clip.wav", duck: [] },
    ];
    const durations = new Map<string, number>([
      ["beat_01", 2.4],
      ["beat_03", 6.2],
    ]);

    const timing = buildTimingTrack(beats, durations);

    expect(timing).toEqual([
      { beatId: "beat_01", startSeconds: 0, endSeconds: 2.4 },
      { beatId: "beat_02", startSeconds: 2.4, endSeconds: 3.9 },
      { beatId: "beat_03", startSeconds: 3.9, endSeconds: 10.1 },
    ]);
  });

  it("throws if a narration beat has no duration", () => {
    expect(() => buildTimingTrack([narrationBeat], new Map())).toThrow(/beat_01/);
  });

  it("degrades a bed beat with no known duration to a zero-length marker", () => {
    const beats: ScriptBeat[] = [
      { id: "beat_03", type: "bed", audio: "clip.wav", duck: [] },
      { id: "beat_04", type: "silence", duration: 1 },
    ];

    const timing = buildTimingTrack(beats, new Map());

    expect(timing).toEqual([
      { beatId: "beat_03", startSeconds: 0, endSeconds: 0 },
      { beatId: "beat_04", startSeconds: 0, endSeconds: 1 },
    ]);
  });
});
