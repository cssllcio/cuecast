import { describe, expect, it } from "vitest";
import type { ScriptBeat, VideoScript } from "../schema/videoScript.js";
import { buildAudioSequences } from "./CuecastComposition.js";
import { buildTimingTrack, decorateTimingTrack } from "../timing/timingExtractor.js";

describe("buildAudioSequences", () => {
  it("converts each timing entry with an audioPath into a frame-positioned sequence", () => {
    const videoScript: VideoScript = {
      id: "example_video",
      diagram: { source: "x.mmd", revealGroups: {} },
      script: [],
      pronunciations: {},
      timing: [
        { beatId: "beat_01", startSeconds: 0, endSeconds: 2.4, audioPath: "audio/beat_01.wav" },
        { beatId: "beat_02", startSeconds: 2.4, endSeconds: 3.9 },
        { beatId: "beat_03", startSeconds: 3.9, endSeconds: 10.1, audioPath: "audio/beat_03.wav" },
      ],
    };

    const sequences = buildAudioSequences(videoScript, 30);

    expect(sequences).toEqual([
      { beatId: "beat_01", audioPath: "audio/beat_01.wav", fromFrame: 0, durationInFrames: 72, volume: 1 },
      { beatId: "beat_03", audioPath: "audio/beat_03.wav", fromFrame: 117, durationInFrames: 186, volume: 1 },
    ]);
  });

  it("returns an empty array when no timing entry has an audioPath", () => {
    const videoScript: VideoScript = {
      id: "example_video",
      diagram: { source: "x.mmd", revealGroups: {} },
      script: [],
      pronunciations: {},
      timing: [{ beatId: "beat_01", startSeconds: 0, endSeconds: 2.4 }],
    };

    expect(buildAudioSequences(videoScript, 30)).toEqual([]);
  });

  // Regression: a bed clamped to the end of the spine (buildTimingTrack) can
  // round to under a full frame, including exactly zero — e.g. a trailing
  // outro bed with no narration after it. Remotion's <Sequence> throws on a
  // non-positive durationInFrames ("durationInFrames ... must be positive,
  // but got 0"), so a spec like this must never reach the composition.
  it("drops a spec with less than one frame of duration", () => {
    const videoScript: VideoScript = {
      id: "example_video",
      diagram: { source: "x.mmd", revealGroups: {} },
      script: [],
      pronunciations: {},
      timing: [
        { beatId: "beat_01", startSeconds: 0, endSeconds: 2, audioPath: "audio/beat_01.wav" },
        // Zero length, exactly — the degenerate case a trailing bed clamps to.
        { beatId: "outro", startSeconds: 2, endSeconds: 2, audioPath: "audio/outro.wav" },
        // Sub-frame but not zero (0.01s * 30fps = 0.3 frames, rounds to 0) —
        // the "under half a frame" case, not only the exactly-zero one.
        { beatId: "sting", startSeconds: 2, endSeconds: 2.01, audioPath: "audio/sting.wav" },
      ],
    };

    const sequences = buildAudioSequences(videoScript, 30);

    expect(sequences).toEqual([
      { beatId: "beat_01", audioPath: "audio/beat_01.wav", fromFrame: 0, durationInFrames: 60, volume: 1 },
    ]);
  });
});

describe("the clamp-to-render seam", () => {
  // Every other test in this file hand-authors its `timing` array. That is
  // exactly the gap the zero-length-bed regression fell through: one test
  // (timingExtractor.test.ts) asserts buildTimingTrack produces a
  // zero-length bed entry, another asserts buildAudioSequences builds specs,
  // and nothing fed the first's real output into the second. This test
  // closes that seam by running the real pipeline — buildTimingTrack, then
  // decorateTimingTrack, exactly as scripts/render-video.ts does — and
  // asserting the result buildAudioSequences hands to Remotion never has
  // less than a full frame of audio.
  it("never hands buildAudioSequences a bed spec with less than a full frame", () => {
    const beats: ScriptBeat[] = [
      { id: "beat_01", type: "narration", text: "t", spoken: "t" },
      { id: "outro", type: "bed", audio: "sting.wav" },
    ];
    const durations = new Map([
      ["beat_01", 2],
      ["outro", 5], // outlasts the spine — clamps to zero, per design §2.
    ]);
    const audioPaths = new Map([
      ["beat_01", "audio/v1/beat_01.wav"],
      ["outro", "audio/v1/outro.wav"],
    ]);

    const timing = decorateTimingTrack(
      buildTimingTrack(beats, durations),
      audioPaths,
      new Map()
    );
    const videoScript: VideoScript = {
      id: "v1",
      diagram: { source: "x.mmd", revealGroups: {} },
      script: beats,
      pronunciations: {},
      timing,
    };

    const sequences = buildAudioSequences(videoScript, 30);

    for (const spec of sequences) {
      expect(spec.durationInFrames).toBeGreaterThanOrEqual(1);
    }
    // The clamped-to-zero outro must not appear at all, not appear with a
    // zero or negative duration.
    expect(sequences.some((spec) => spec.beatId === "outro")).toBe(false);
    expect(sequences.map((spec) => spec.beatId)).toEqual(["beat_01"]);
  });
});

describe("buildAudioSequences ducking", () => {
  const script = {
    id: "v1",
    diagram: { source: "d.mmd", revealGroups: {} },
    pronunciations: {},
    script: [
      { id: "music", type: "bed" as const, audio: "m.wav", duck: ["beat_01"], duckTo: 0.25 },
      { id: "beat_01", type: "narration" as const, text: "t", spoken: "t" },
    ],
    timing: [
      { beatId: "music", startSeconds: 0, endSeconds: 4, audioPath: "audio/v1/music.wav" },
      { beatId: "beat_01", startSeconds: 1, endSeconds: 2, audioPath: "audio/v1/beat_01.wav" },
    ],
  };

  it("gives a ducked bed a volume function, and narration a plain 1", () => {
    const [bed, narration] = buildAudioSequences(script, 30);

    expect(typeof bed.volume).toBe("function");
    expect(narration.volume).toBe(1);
  });

  // Remotion hands <Audio volume> a frame relative to the Sequence, so the
  // spec has to convert with frame / fps before evaluating the envelope.
  it("evaluates the bed's volume in Sequence-relative frames", () => {
    const [bed] = buildAudioSequences(script, 30);
    const volumeAt = bed.volume as (frame: number) => number;

    expect(volumeAt(0)).toBe(1);                  // 0s — before the duck
    expect(volumeAt(45)).toBeCloseTo(0.25, 6);    // 1.5s — inside it
    expect(volumeAt(105)).toBe(1);                // 3.5s — well after
  });

  it("leaves a bed with no duck at full gain", () => {
    const plain = {
      ...script,
      script: [{ id: "music", type: "bed" as const, audio: "m.wav" }, script.script[1]],
    };
    const [bed] = buildAudioSequences(plain, 30);

    expect(bed.volume).toBe(1);
  });

  // One audio path can now produce more than one sequence, so a path-keyed
  // React list would collide and silently drop audio.
  it("carries the beat id for use as the React key", () => {
    const [bed, narration] = buildAudioSequences(script, 30);

    expect(bed.beatId).toBe("music");
    expect(narration.beatId).toBe("beat_01");
  });
});
