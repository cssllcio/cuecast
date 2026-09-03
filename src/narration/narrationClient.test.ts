import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NarrationClient } from "./narrationClient.js";

const BASE = "http://127.0.0.1:17493";
const WAV_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x01, 0x02, 0x03]);

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function wavResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => WAV_BYTES.buffer.slice(0),
  };
}

// Routes a mocked fetch by URL and records every call. Only the network is
// mocked; URL routing, body shape, status handling, polling, and the file
// write are all real client behavior under test.
function routedFetch(
  historyStatuses: Array<Record<string, unknown>>,
  options: { generateStatus?: number; exportStatus?: number } = {}
) {
  let historyCall = 0;
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `${BASE}/generate`) {
      return jsonResponse(
        { id: "gen-123", status: "generating", audio_path: "" },
        options.generateStatus ?? 200
      );
    }
    if (url === `${BASE}/history/gen-123/export-audio`) {
      return wavResponse(options.exportStatus ?? 200);
    }
    if (url === `${BASE}/history/gen-123`) {
      const body = historyStatuses[Math.min(historyCall, historyStatuses.length - 1)];
      historyCall += 1;
      return jsonResponse(body);
    }
    throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
  });
  return fetchImpl as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("NarrationClient.generate", () => {
  let audioOutputDir: string;
  const sleepImpl = vi.fn(async () => {});

  beforeEach(() => {
    audioOutputDir = mkdtempSync(join(tmpdir(), "cuecast-narration-"));
    sleepImpl.mockClear();
  });

  afterEach(() => {
    rmSync(audioOutputDir, { recursive: true, force: true });
  });

  it("posts text, profile, engine and seed to /generate", async () => {
    const fetchImpl = routedFetch([
      { status: "completed", duration: 3.22, error: null, seed: 4000 },
    ]);
    const client = new NarrationClient({
      baseUrl: BASE,
      profileId: "test-profile",
      audioOutputDir,
      engine: "chatterbox",
      fetchImpl,
      sleepImpl,
    });

    await client.generate("hello world", 4000);

    const [, init] = fetchImpl.mock.calls.find(([url]) => url === `${BASE}/generate`)!;
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      text: "hello world",
      profile_id: "test-profile",
      engine: "chatterbox",
      seed: 4000,
    });
  });

  // If the service ignored the seed, every render would look correct while
  // reproducibility was quietly gone — the shape of issue #1, where the file
  // existed and the audio did not. Verified live on 2026-09-02: Voicebox
  // echoes the seed on both /generate and /history.
  it("throws when the service reports a different seed than the one sent", async () => {
    const fetchImpl = routedFetch([
      { status: "completed", duration: 3.22, error: null, seed: 9999 },
    ]);
    const client = new NarrationClient({
      baseUrl: BASE,
      profileId: "test-profile",
      audioOutputDir,
      fetchImpl,
      sleepImpl,
    });

    await expect(client.generate("hello world", 4000)).rejects.toThrow(
      /seed/i
    );
  });

  it("throws when a completed generation reports no seed at all", async () => {
    // Absence is not proof of ignorance in general, but here it is: Pydantic
    // (Voicebox's request layer) drops unknown fields silently, so a build
    // predating seed support would accept the seeded POST, generate unseeded
    // audio, and report no seed back. That is indistinguishable from a
    // service that understood the field and ignored it — the exact failure
    // §5 exists to catch — so absence must fail closed, not be tolerated.
    const fetchImpl = routedFetch([
      { status: "completed", duration: 3.22, error: null },
    ]);
    const client = new NarrationClient({
      baseUrl: BASE,
      profileId: "test-profile",
      audioOutputDir,
      fetchImpl,
      sleepImpl,
    });

    await expect(client.generate("hello world", 4000)).rejects.toThrow(
      /no seed/i
    );
  });

  it("defaults the engine to chatterbox when none is configured", async () => {
    const fetchImpl = routedFetch([{ status: "completed", duration: 1, error: null, seed: 4000 }]);
    const client = new NarrationClient({
      baseUrl: BASE,
      profileId: "test-profile",
      audioOutputDir,
      fetchImpl,
      sleepImpl,
    });

    await client.generate("hi", 4000);

    const [, init] = fetchImpl.mock.calls.find(([url]) => url === `${BASE}/generate`)!;
    expect(JSON.parse(init.body as string).engine).toBe("chatterbox");
  });

  it("polls /history until completed, then returns the duration and a local audio file", async () => {
    const fetchImpl = routedFetch([
      { status: "loading_model", duration: 0, error: null },
      { status: "generating", duration: 0, error: null },
      { status: "completed", duration: 3.22, error: null, seed: 4000 },
    ]);
    const client = new NarrationClient({
      baseUrl: BASE,
      profileId: "test-profile",
      audioOutputDir,
      fetchImpl,
      sleepImpl,
      pollIntervalMs: 1000,
    });

    const result = await client.generate("hello world", 4000);

    expect(result.durationSeconds).toBe(3.22);
    expect(result.audioPath).toBe(join(audioOutputDir, "gen-123.wav"));
    expect(existsSync(result.audioPath)).toBe(true);
    expect(new Uint8Array(readFileSync(result.audioPath))).toEqual(WAV_BYTES);

    const historyCalls = fetchImpl.mock.calls.filter(
      ([url]) => url === `${BASE}/history/gen-123`
    );
    expect(historyCalls).toHaveLength(3);
    // slept once between each non-terminal poll, never after completion
    expect(sleepImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(1000);
  });

  it("throws with the server's error message when the generation fails", async () => {
    const fetchImpl = routedFetch([
      { status: "generating", duration: 0, error: null },
      { status: "failed", duration: 0, error: "Server was shut down during generation" },
    ]);
    const client = new NarrationClient({
      baseUrl: BASE,
      profileId: "test-profile",
      audioOutputDir,
      fetchImpl,
      sleepImpl,
    });

    await expect(client.generate("hello", 4000)).rejects.toThrow(
      /gen-123.*Server was shut down during generation/
    );
    expect(existsSync(join(audioOutputDir, "gen-123.wav"))).toBe(false);
  });

  it("throws when a generation completes without reporting a duration", async () => {
    // duration drives beat timing, so a completed generation with no
    // duration is unusable. Defaulting it to 0 would produce a silent
    // zero-length beat that buildTimingTrack cannot tell from a real one.
    const fetchImpl = routedFetch([{ status: "completed", duration: null, error: null }]);
    const client = new NarrationClient({
      baseUrl: BASE,
      profileId: "test-profile",
      audioOutputDir,
      fetchImpl,
      sleepImpl,
    });

    await expect(client.generate("hello", 4000)).rejects.toThrow(/gen-123.*completed.*no duration/);
    expect(existsSync(join(audioOutputDir, "gen-123.wav"))).toBe(false);
  });

  it("keeps polling through an unrecognized status rather than treating it as terminal", async () => {
    // Characterization test: locks in that only completed/failed end the
    // loop, so a new non-terminal status Voicebox might add (e.g. "queued")
    // can't be mistaken for success or failure.
    const fetchImpl = routedFetch([
      { status: "queued", duration: 0, error: null },
      { status: "completed", duration: 1.5, error: null, seed: 4000 },
    ]);
    const client = new NarrationClient({
      baseUrl: BASE,
      profileId: "test-profile",
      audioOutputDir,
      fetchImpl,
      sleepImpl,
    });

    const result = await client.generate("hello", 4000);

    expect(result.durationSeconds).toBe(1.5);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it("throws once the poll timeout elapses without completion", async () => {
    // A wedged server reports loading_model forever with error: null — the
    // failure mode that hung the first live run. The fake clock advances
    // 5s per poll; a 12s budget must give up on the third poll.
    let fakeNow = 0;
    const fetchImpl = routedFetch([{ status: "loading_model", duration: 0, error: null }]);
    const client = new NarrationClient({
      baseUrl: BASE,
      profileId: "test-profile",
      audioOutputDir,
      fetchImpl,
      sleepImpl: async () => {
        fakeNow += 5000;
      },
      now: () => fakeNow,
      timeoutMs: 12_000,
    });

    await expect(client.generate("hello", 4000)).rejects.toThrow(/timed out.*12000.*loading_model/);
    const historyCalls = fetchImpl.mock.calls.filter(
      ([url]) => url === `${BASE}/history/gen-123`
    );
    expect(historyCalls).toHaveLength(3);
  });

  it("throws when /generate responds with a non-ok status", async () => {
    const fetchImpl = routedFetch([], { generateStatus: 500 });
    const client = new NarrationClient({
      baseUrl: BASE,
      profileId: "test-profile",
      audioOutputDir,
      fetchImpl,
      sleepImpl,
    });

    await expect(client.generate("hello", 4000)).rejects.toThrow(/\/generate.*500/);
  });

  it("throws when export-audio responds with a non-ok status", async () => {
    const fetchImpl = routedFetch([{ status: "completed", duration: 1, error: null, seed: 4000 }], {
      exportStatus: 404,
    });
    const client = new NarrationClient({
      baseUrl: BASE,
      profileId: "test-profile",
      audioOutputDir,
      fetchImpl,
      sleepImpl,
    });

    await expect(client.generate("hello", 4000)).rejects.toThrow(/export-audio.*404/);
  });
});
