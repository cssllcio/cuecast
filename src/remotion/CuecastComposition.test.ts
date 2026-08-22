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
      { audioPath: "audio/beat_01.wav", fromFrame: 0 },
      { audioPath: "audio/beat_03.wav", fromFrame: 117 },
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
