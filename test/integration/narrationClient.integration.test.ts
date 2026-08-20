import { describe, expect, it } from "vitest";
import { NarrationClient } from "../../src/narration/narrationClient.js";

const baseUrl = process.env.CUECAST_TTS_URL;

describe.skipIf(!baseUrl)("NarrationClient (live service)", () => {
  it("generates and transcribes a real phrase, and reports the timestamp granularity found", async () => {
    const client = new NarrationClient({
      baseUrl: baseUrl!,
      profileId: process.env.CUECAST_TTS_PROFILE_ID ?? "default",
    });

    const generated = await client.generate("This is a granularity check.");
    const transcribed = await client.transcribe(generated.audioPath);

    expect(transcribed.segments.length).toBeGreaterThan(0);

    const hasWordLevel = transcribed.segments.some(
      (segment) => segment.words && segment.words.length > 0
    );
    console.log(
      `[granularity finding] word-level timestamps present: ${hasWordLevel}`
    );
    console.log(JSON.stringify(transcribed, null, 2));
  });
}, 60_000);
