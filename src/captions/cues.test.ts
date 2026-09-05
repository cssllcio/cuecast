import { describe, expect, it } from "vitest";
import type { VideoScript } from "../schema/videoScript.js";
import { buildCues } from "./cues.js";

const script: VideoScript = {
  id: "v1",
  diagram: { source: "d.mmd", revealGroups: {} },
  pronunciations: {},
  script: [
    { id: "beat_01", type: "narration", text: "The API talks to it.", spoken: "The A P I talks to it." },
    { id: "gap", type: "silence", duration: 1 },
    { id: "music", type: "bed", audio: "m.wav" },
    { id: "beat_02", type: "narration", text: "It writes through SQL.", spoken: "It writes through S Q L." },
  ],
  timing: [
    { beatId: "beat_01", startSeconds: 0, endSeconds: 1.86 },
    { beatId: "gap", startSeconds: 1.86, endSeconds: 2.86 },
    { beatId: "music", startSeconds: 1.86, endSeconds: 2.86 },
    { beatId: "beat_02", startSeconds: 2.86, endSeconds: 5.28 },
  ],
};

describe("buildCues", () => {
  // The caption track should have a real hole where the video is silent.
  // The timeline itself has none — narration and silence abut exactly — so
  // dropping non-narration entries is what creates the gap.
  it("emits one cue per narration beat, skipping silence and bed", () => {
    expect(buildCues(script)).toEqual([
      { startSeconds: 0, endSeconds: 1.86, text: "The API talks to it." },
      { startSeconds: 2.86, endSeconds: 5.28, text: "It writes through SQL." },
    ]);
  });

  // The whole reason the schema carries both fields: a respelling must never
  // reach anything a viewer reads.
  it("uses text, never spoken", () => {
    for (const cue of buildCues(script)) {
      expect(cue.text).not.toMatch(/A P I|S Q L/);
    }
  });

  it("returns nothing for a script with no narration", () => {
    expect(
      buildCues({
        ...script,
        script: [{ id: "gap", type: "silence", duration: 1 }],
        timing: [{ beatId: "gap", startSeconds: 0, endSeconds: 1 }],
      })
    ).toEqual([]);
  });

  // A script parsed but never rendered has an empty timing block, and asking
  // for captions before generation is a plausible mistake rather than a crash.
  it("returns nothing when timing has not been generated yet", () => {
    expect(buildCues({ ...script, timing: [] })).toEqual([]);
  });
});
