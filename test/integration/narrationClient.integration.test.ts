import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NarrationClient } from "../../src/narration/narrationClient.js";
import { probeAudioDurationSeconds } from "../../src/audio/probeAudioDuration.js";

const baseUrl = process.env.CUECAST_TTS_URL;

describe.skipIf(!baseUrl)("NarrationClient (live service)", () => {
  let audioOutputDir: string;

  beforeEach(() => {
    audioOutputDir = mkdtempSync(join(tmpdir(), "cuecast-live-narration-"));
  });

  afterEach(() => {
    rmSync(audioOutputDir, { recursive: true, force: true });
  });

  it("generates a real phrase and returns a local WAV whose duration matches the reported one", async () => {
    const client = new NarrationClient({
      baseUrl: baseUrl!,
      profileId: process.env.CUECAST_TTS_PROFILE_ID ?? "default",
      audioOutputDir,
    });

    const result = await client.generate("This is a live generation check.", 4000);

    expect(result.durationSeconds).toBeGreaterThan(0);
    expect(existsSync(result.audioPath)).toBe(true);

    // The reported duration is what drives beat timing, so it must agree
    // with the audio actually fetched — verified to match exactly (3.22 vs
    // ffprobe 3.220000) on 2026-08-22; allow a frame of slack here.
    const probed = await probeAudioDurationSeconds(result.audioPath);
    expect(probed).toBeCloseTo(result.durationSeconds, 1);
  });
}, 240_000);
