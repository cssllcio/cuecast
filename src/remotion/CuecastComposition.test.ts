import { describe, expect, it } from "vitest";
import type { VideoScript } from "../schema/videoScript.js";
import { buildAudioSequences } from "./CuecastComposition.js";

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
