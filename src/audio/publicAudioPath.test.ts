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
    ["video id that is a bare parent reference", "..", "beat_01"],
    ["beat id with a slash", "video", "be/at"],
    ["beat id that is a bare parent reference", "video", ".."],
    ["beat id with a parent reference segment", "video", "../beat"],
    // Not traversal, but both normalize the segment away — `audio//x` and
    // `audio/./x` collapse to `audio/x` — silently undoing the per-video
    // namespacing and recreating the exact collision issue #4 is about.
    ["video id that is empty", "", "beat_01"],
    ["video id that is a bare current-directory reference", ".", "beat_01"],
    ["beat id that is empty", "video", ""],
    ["beat id that is a bare current-directory reference", "video", "."],
  ])("rejects a %s", (_label, videoId, beatId) => {
    expect(() => publicAudioPath(videoId, beatId, "x.wav")).toThrow(
      /path separator|parent|must be a non-empty name/
    );
  });

  it("allows '..' as a substring, since without a separator it is just a name", () => {
    expect(publicAudioPath("a..b", "beat_01", "x.wav")).toBe("audio/a..b/beat_01.wav");
  });
});
