import { describe, expect, it, vi } from "vitest";
import { NarrationClient } from "./narrationClient.js";

describe("NarrationClient", () => {
  it("posts spoken text to /generate and returns the audio path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ audio_path: "/tmp/beat_01.wav" }),
    });

    const client = new NarrationClient({
      baseUrl: "http://127.0.0.1:17493",
      profileId: "test-profile",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.generate("hello world");

    expect(result.audioPath).toBe("/tmp/beat_01.wav");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:17493/generate");
    expect(options).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      })
    );
    expect(JSON.parse(options.body as string)).toEqual({
      text: "hello world",
      profile_id: "test-profile",
    });
  });

  it("posts an audio path to /transcribe and returns segments", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        segments: [{ text: "hello world", start: 0.0, end: 1.2 }],
      }),
    });

    const client = new NarrationClient({
      baseUrl: "http://127.0.0.1:17493",
      profileId: "test-profile",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.transcribe("/tmp/beat_01.wav");

    expect(result.segments).toEqual([
      { text: "hello world", startSeconds: 0.0, endSeconds: 1.2, words: undefined },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:17493/transcribe");
    expect(options).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      })
    );
    expect(JSON.parse(options.body as string)).toEqual({
      audio_path: "/tmp/beat_01.wav",
    });
  });

  it("throws when the service responds with a non-ok status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const client = new NarrationClient({
      baseUrl: "http://127.0.0.1:17493",
      profileId: "test-profile",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.generate("hello")).rejects.toThrow(/500/);
  });
});
