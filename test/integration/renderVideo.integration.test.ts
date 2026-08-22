import { existsSync } from "node:fs";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { renderVideo } from "../../scripts/render-video.js";

const baseUrl = process.env.CUECAST_TTS_URL;

describe.skipIf(!baseUrl)("renderVideo (live service, end to end)", () => {
  it("generates narration, lays out timing, and renders a video that actually carries the narration audio", async () => {
    const outputPath = "out/example-video.mp4";
    await renderVideo("test/fixtures/example-video.json", outputPath);

    expect(existsSync(outputPath)).toBe(true);

    // A file-exists check passed even while narration was silently dropped
    // (issue #1) and while inputProps never reached the composition (PR #3).
    // Remotion always muxes an AAC track, silent or not, so stream presence
    // proves nothing either; measure the signal. Silence sits at ffmpeg's
    // -91 dB floor — real narration is far above -50 dB.
    const { stderr } = await execa("ffmpeg", [
      "-i",
      outputPath,
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ]);
    const maxVolumeMatch = stderr.match(/max_volume:\s*(-?\d+(\.\d+)?)\s*dB/);
    expect(maxVolumeMatch).not.toBeNull();
    expect(Number(maxVolumeMatch?.[1])).toBeGreaterThan(-50);
  });
}, 600_000);
