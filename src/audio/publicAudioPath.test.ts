import { describe, expect, it } from "vitest";
import { publicAudioPath } from "./publicAudioPath.js";

describe("publicAudioPath", () => {
  it("derives a public/-relative path from the beat id and source extension", () => {
    expect(publicAudioPath("beat_01", "/tmp/generated/xyz123.wav")).toBe(
      "audio/beat_01.wav"
    );
  });

  it("preserves an extension other than .wav", () => {
    expect(publicAudioPath("beat_03", "clip.mp3")).toBe("audio/beat_03.mp3");
  });
});
