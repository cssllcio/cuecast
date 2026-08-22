import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderVideo } from "../../scripts/render-video.js";

const baseUrl = process.env.CUECAST_TTS_URL;

describe.skipIf(!baseUrl)("renderVideo (live service, end to end)", () => {
  it("generates narration, extracts timing, and renders a real video", async () => {
    const outputPath = "out/example-video.mp4";
    await renderVideo("test/fixtures/example-video.json", outputPath);

    expect(existsSync(outputPath)).toBe(true);
    expect(statSync(outputPath).size).toBeGreaterThan(0);
  });
}, 180_000);
