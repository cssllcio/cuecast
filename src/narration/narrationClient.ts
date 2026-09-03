import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Client for Voicebox's REST API, written against the contract verified live
// on 2026-08-22 (see cuecast issue #6 and spikes/narration-granularity):
//
//   POST /generate                  -> 202-ish: { id, status: "generating", audio_path: "" }
//   GET  /history/{id}              -> { status, duration, error, ... }  (poll)
//   GET  /history/{id}/export-audio -> audio/wav bytes
//
// There is no transcription step. Voicebox's /transcribe returns only
// { text, duration } — no segment or word timestamps — so beat timing comes
// from the completed generation's `duration` instead.
export interface NarrationClientConfig {
  baseUrl: string;
  profileId: string;
  /** Directory the fetched WAV is written into; created if missing. */
  audioOutputDir: string;
  /** Voicebox engine. Defaults to "chatterbox" — the qwen default wedged a server on first contact. */
  engine?: string;
  pollIntervalMs?: number;
  /** Give up on a generation that never reaches completed/failed. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface GenerateResult {
  /** Local path of the fetched audio file. */
  audioPath: string;
  durationSeconds: number;
}

interface GenerateResponse {
  id: string;
}

interface HistoryResponse {
  status: string;
  duration: number | null;
  error: string | null;
  seed?: number | null;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class NarrationClient {
  private readonly baseUrl: string;
  private readonly profileId: string;
  private readonly audioOutputDir: string;
  private readonly engine: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(config: NarrationClientConfig) {
    this.baseUrl = config.baseUrl;
    this.profileId = config.profileId;
    this.audioOutputDir = config.audioOutputDir;
    this.engine = config.engine ?? "chatterbox";
    this.pollIntervalMs = config.pollIntervalMs ?? 1000;
    this.timeoutMs = config.timeoutMs ?? 180_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.sleepImpl = config.sleepImpl ?? defaultSleep;
    this.now = config.now ?? Date.now;
  }

  async generate(spokenText: string, seed: number): Promise<GenerateResult> {
    const id = await this.startGeneration(spokenText, seed);
    const durationSeconds = await this.waitForCompletion(id, seed);
    const audioPath = await this.fetchAudio(id);
    return { audioPath, durationSeconds };
  }

  private async startGeneration(spokenText: string, seed: number): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: spokenText,
        profile_id: this.profileId,
        engine: this.engine,
        seed,
      }),
    });
    if (!response.ok) {
      throw new Error(`narration /generate failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as GenerateResponse;
    return body.id;
  }

  private async waitForCompletion(id: string, seed: number): Promise<number> {
    const startedAt = this.now();
    let lastStatus = "unknown";
    for (;;) {
      // Budget check happens before each poll, so a spent budget never costs
      // one more network round-trip. A wedged server reports loading_model
      // forever with error: null — without this, the client hangs with it.
      if (this.now() - startedAt >= this.timeoutMs) {
        throw new Error(
          `narration generation ${id} timed out after ${this.timeoutMs}ms (last status: ${lastStatus})`
        );
      }

      const response = await this.fetchImpl(`${this.baseUrl}/history/${id}`);
      if (!response.ok) {
        throw new Error(`narration /history/${id} failed: HTTP ${response.status}`);
      }
      const body = (await response.json()) as HistoryResponse;
      lastStatus = body.status;

      if (body.status === "completed") {
        // duration drives beat timing; a completed generation without one is
        // unusable. Defaulting to 0 would yield a silent zero-length beat
        // indistinguishable from a real one — the same class of silent
        // failure that shipped in issue #1 and the PR #3 inputProps bug.
        if (body.duration === null || body.duration === undefined) {
          throw new Error(`narration generation ${id} completed with no duration reported`);
        }
        // A seed the service silently ignored would leave every render looking
        // fine while reproducibility was gone — the exact failure this field
        // exists to catch (design §5). A build that doesn't understand `seed`
        // is not hypothetical: Pydantic drops unknown request fields by
        // default, so a Voicebox predating seed support accepts the POST,
        // generates unseeded audio, and reports no seed back — indistinguishable
        // from "ignored" without this check. Absence is therefore an error, the
        // same as a mismatch; only distinguished so the message says which.
        if (body.seed === null || body.seed === undefined) {
          throw new Error(
            `narration generation ${id} completed but reported no seed at all (requested ${seed}); ` +
              `the service may not support seeding`
          );
        }
        if (body.seed !== seed) {
          throw new Error(
            `narration generation ${id} used seed ${body.seed}, not the requested ${seed}`
          );
        }
        return body.duration;
      }
      if (body.status === "failed") {
        throw new Error(`narration generation ${id} failed: ${body.error ?? "unknown error"}`);
      }
      await this.sleepImpl(this.pollIntervalMs);
    }
  }

  private async fetchAudio(id: string): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/history/${id}/export-audio`);
    if (!response.ok) {
      throw new Error(`narration /history/${id}/export-audio failed: HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    mkdirSync(this.audioOutputDir, { recursive: true });
    const audioPath = join(this.audioOutputDir, `${id}.wav`);
    writeFileSync(audioPath, bytes);
    return audioPath;
  }
}
