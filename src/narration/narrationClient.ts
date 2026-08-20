export interface NarrationClientConfig {
  baseUrl: string;
  profileId: string;
  fetchImpl?: typeof fetch;
}

export interface GenerateResult {
  audioPath: string;
}

export interface TranscribeWord {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface TranscribeSegment {
  text: string;
  startSeconds: number;
  endSeconds: number;
  words?: TranscribeWord[];
}

export interface TranscribeResult {
  segments: TranscribeSegment[];
}

export class NarrationClient {
  private readonly baseUrl: string;
  private readonly profileId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: NarrationClientConfig) {
    this.baseUrl = config.baseUrl;
    this.profileId = config.profileId;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generate(spokenText: string): Promise<GenerateResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: spokenText, profile_id: this.profileId }),
    });

    if (!response.ok) {
      throw new Error(`narration /generate failed: HTTP ${response.status}`);
    }

    const body = (await response.json()) as { audio_path: string };
    return { audioPath: body.audio_path };
  }

  async transcribe(audioPath: string): Promise<TranscribeResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audio_path: audioPath }),
    });

    if (!response.ok) {
      throw new Error(`narration /transcribe failed: HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      segments: Array<{
        text: string;
        start: number;
        end: number;
        words?: Array<{ text: string; start: number; end: number }>;
      }>;
    };

    return {
      segments: body.segments.map((segment) => ({
        text: segment.text,
        startSeconds: segment.start,
        endSeconds: segment.end,
        words: segment.words?.map((word) => ({
          text: word.text,
          startSeconds: word.start,
          endSeconds: word.end,
        })),
      })),
    };
  }
}
