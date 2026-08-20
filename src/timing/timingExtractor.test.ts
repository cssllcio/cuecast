import { describe, expect, it } from "vitest";
import type { NarrationBeat, ScriptBeat } from "../schema/videoScript.js";
import type { TranscribeResult } from "../narration/narrationClient.js";
import { buildTimingTrack, extractBeatTiming } from "./timingExtractor.js";

const narrationBeat: NarrationBeat = {
  id: "beat_01",
  type: "narration",
  text: "The API talks to the database.",
  spoken: "The A P I talks to the database.",
};

describe("extractBeatTiming", () => {
  it("aligns on segment boundaries and applies the timeline offset", () => {
    const transcribeResult: TranscribeResult = {
      segments: [
        { text: "The A P I talks to the database.", startSeconds: 0, endSeconds: 2.4 },
      ],
    };

    const entry = extractBeatTiming(narrationBeat, transcribeResult, 5.0);

    expect(entry).toEqual({ beatId: "beat_01", startSeconds: 5.0, endSeconds: 7.4 });
  });
});

describe("buildTimingTrack", () => {
  it("lays out narration, silence, and bed beats sequentially on one timeline", () => {
    const beats: ScriptBeat[] = [
      narrationBeat,
      { id: "beat_02", type: "silence", duration: 1.5 },
      { id: "beat_03", type: "bed", audio: "clip.wav", duck: [] },
    ];

    const transcriptions = new Map<string, TranscribeResult>([
      [
        "beat_01",
        { segments: [{ text: "...", startSeconds: 0, endSeconds: 2.4 }] },
      ],
    ]);

    const timing = buildTimingTrack(beats, transcriptions);

    expect(timing).toEqual([
      { beatId: "beat_01", startSeconds: 0, endSeconds: 2.4 },
      { beatId: "beat_02", startSeconds: 2.4, endSeconds: 3.9 },
      { beatId: "beat_03", startSeconds: 3.9, endSeconds: 3.9 },
    ]);
  });

  it("throws if a narration beat has no matching transcription", () => {
    const beats: ScriptBeat[] = [narrationBeat];
    expect(() => buildTimingTrack(beats, new Map())).toThrow(/beat_01/);
  });
});
