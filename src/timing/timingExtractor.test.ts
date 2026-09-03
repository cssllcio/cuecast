import { describe, expect, it } from "vitest";
import type { NarrationBeat, ScriptBeat } from "../schema/videoScript.js";
import {
  buildTimingTrack,
  decorateTimingTrack,
  describeBedClamps,
  extractBeatTiming,
} from "./timingExtractor.js";

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
  it("lays out narration and silence sequentially, floating the bed beat over the spine", () => {
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

    // The spine (narration + silence) ends at 3.9s. The bed does not advance
    // the cursor, so it starts at the spine position it sits in (3.9s) — and
    // since nothing follows it, it is clamped down to that same 3.9s, giving
    // it zero length rather than the 6.2s it requested.
    expect(timing).toEqual([
      { beatId: "beat_01", startSeconds: 0, endSeconds: 2.4 },
      { beatId: "beat_02", startSeconds: 2.4, endSeconds: 3.9 },
      { beatId: "beat_03", startSeconds: 3.9, endSeconds: 3.9 },
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

describe("decorateTimingTrack", () => {
  it("attaches audioPath and seed to a narration entry present in both maps", () => {
    const timing = [{ beatId: "beat_01", startSeconds: 0, endSeconds: 2.4 }];
    const audioPaths = new Map([["beat_01", "audio/example_video/beat_01.wav"]]);
    const seeds = new Map([["beat_01", 4000]]);

    const decorated = decorateTimingTrack(timing, audioPaths, seeds);

    expect(decorated).toEqual([
      {
        beatId: "beat_01",
        startSeconds: 0,
        endSeconds: 2.4,
        audioPath: "audio/example_video/beat_01.wav",
        seed: 4000,
      },
    ]);
  });

  // A `bed`/`silence` beat never reaches the TTS, so it is absent from
  // `seeds` (design §4). The map lookup returns `undefined`, and the naive
  // `{ ...entry, seed }` would write a literal `seed: undefined` key —
  // which `JSON.stringify` drops on `writeFileSync`, but `toEqual` would
  // pass right past it. Assert the key is absent from the object itself,
  // not just absent from the serialized JSON.
  it("omits the seed key entirely for a bed/silence entry, not seed: undefined", () => {
    const timing = [{ beatId: "beat_02", startSeconds: 2.4, endSeconds: 3.9 }];
    const audioPaths = new Map<string, string>();
    const seeds = new Map<string, number>();

    const decorated = decorateTimingTrack(timing, audioPaths, seeds);

    expect(decorated[0]).not.toHaveProperty("seed");
    expect(decorated[0]).not.toHaveProperty("audioPath");
    expect(Object.keys(decorated[0])).toEqual(["beatId", "startSeconds", "endSeconds"]);
  });

  it("keeps a seed of 0 rather than treating it as absent", () => {
    const timing = [{ beatId: "beat_01", startSeconds: 0, endSeconds: 2.4 }];
    const audioPaths = new Map<string, string>();
    const seeds = new Map([["beat_01", 0]]);

    const decorated = decorateTimingTrack(timing, audioPaths, seeds);

    expect(decorated[0]).toMatchObject({ seed: 0 });
  });
});

describe("bed beats as a parallel lane", () => {
  const narration = (id: string): ScriptBeat => ({
    id,
    type: "narration",
    text: "t",
    spoken: "t",
  });

  it("does not let a bed advance the cursor", () => {
    const beats: ScriptBeat[] = [
      { id: "music", type: "bed", audio: "m.wav" },
      narration("beat_01"),
    ];
    const durations = new Map([["music", 6], ["beat_01", 2]]);

    const timing = buildTimingTrack(beats, durations);

    // The narration starts at 0, not after the bed — that overlap is the
    // whole point: a bed that occupied its own slot could never be ducked.
    expect(timing).toEqual([
      { beatId: "music", startSeconds: 0, endSeconds: 2 },
      { beatId: "beat_01", startSeconds: 0, endSeconds: 2 },
    ]);
  });

  it("clamps a bed that outlasts the spine", () => {
    const beats: ScriptBeat[] = [
      { id: "music", type: "bed", audio: "m.wav" },
      narration("beat_01"),
    ];
    // 60s of music over a 2s spine.
    const timing = buildTimingTrack(beats, new Map([["music", 60], ["beat_01", 2]]));

    expect(timing[0]).toEqual({ beatId: "music", startSeconds: 0, endSeconds: 2 });
  });

  it("still lays narration and silence back to back", () => {
    const beats: ScriptBeat[] = [
      narration("beat_01"),
      { id: "gap", type: "silence", duration: 1 },
      narration("beat_02"),
    ];
    const timing = buildTimingTrack(
      beats,
      new Map([["beat_01", 2], ["beat_02", 3]])
    );

    expect(timing).toEqual([
      { beatId: "beat_01", startSeconds: 0, endSeconds: 2 },
      { beatId: "gap", startSeconds: 2, endSeconds: 3 },
      { beatId: "beat_02", startSeconds: 3, endSeconds: 6 },
    ]);
  });

  it("gives a bed placed after the last narration beat zero length", () => {
    const beats: ScriptBeat[] = [
      narration("beat_01"),
      { id: "outro", type: "bed", audio: "m.wav" },
    ];
    const timing = buildTimingTrack(beats, new Map([["beat_01", 2], ["outro", 5]]));

    expect(timing[1]).toEqual({ beatId: "outro", startSeconds: 2, endSeconds: 2 });
  });
});

describe("describeBedClamps", () => {
  it("reports a bed whose audio was cut short, with both durations", () => {
    const beats: ScriptBeat[] = [
      { id: "music", type: "bed", audio: "m.wav" },
      { id: "beat_01", type: "narration", text: "t", spoken: "t" },
    ];
    const durations = new Map([["music", 60], ["beat_01", 2]]);
    const timing = buildTimingTrack(beats, durations);

    expect(describeBedClamps(beats, durations, timing)).toEqual([
      { beatId: "music", requestedSeconds: 60, actualSeconds: 2 },
    ]);
  });

  it("reports nothing when every bed fits", () => {
    const beats: ScriptBeat[] = [
      { id: "music", type: "bed", audio: "m.wav" },
      { id: "beat_01", type: "narration", text: "t", spoken: "t" },
    ];
    const durations = new Map([["music", 2], ["beat_01", 5]]);
    const timing = buildTimingTrack(beats, durations);

    expect(describeBedClamps(beats, durations, timing)).toEqual([]);
  });
});
