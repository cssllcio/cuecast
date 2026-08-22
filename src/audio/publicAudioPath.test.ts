import { describe, expect, it } from "vitest";
import { publicAudioPath } from "./publicAudioPath.js";

describe("publicAudioPath", () => {
  it("namespaces the beat's audio under the video id", () => {
    expect(publicAudioPath("example_video", "beat_01", "/tmp/generated/xyz123.wav")).toBe(
      "audio/example_video/beat_01.wav"
    );
  });

  it("gives two videos that reuse a beat id distinct paths", () => {
    const a = publicAudioPath("video_a", "beat_01", "a.wav");
    const b = publicAudioPath("video_b", "beat_01", "b.wav");
    expect(a).not.toBe(b);
  });

  it("preserves an extension other than .wav", () => {
    expect(publicAudioPath("example_video", "beat_03", "clip.mp3")).toBe(
      "audio/example_video/beat_03.mp3"
    );
  });

  // Both ids come from free-form JSON and become a path on disk under
  // public/audio/. Nothing upstream constrains them, so a separator or a
  // parent reference would let a crafted id write outside that directory.
  it.each([
    ["video id with a slash", "vid/eo", "beat_01"],
    ["video id with a backslash", "vid\\eo", "beat_01"],
    ["video id with a parent reference", "..", "beat_01"],
    ["beat id with a slash", "video", "be/at"],
    ["beat id with a parent reference", "video", "../beat"],
  ])("rejects a %s", (_label, videoId, beatId) => {
    expect(() => publicAudioPath(videoId, beatId, "x.wav")).toThrow(/path separator|parent/);
  });
});
