import type { NarrationBeat, ScriptBeat, TimingEntry } from "../schema/videoScript.js";
import type { TranscribeResult } from "../narration/narrationClient.js";

export function extractBeatTiming(
  beat: NarrationBeat,
  transcribeResult: TranscribeResult,
  offsetSeconds: number
): TimingEntry {
  const first = transcribeResult.segments.at(0);
  const last = transcribeResult.segments.at(-1);

  if (!first || !last) {
    throw new Error(`no transcription segments for beat ${beat.id}`);
  }

  return {
    beatId: beat.id,
    startSeconds: offsetSeconds + first.startSeconds,
    endSeconds: offsetSeconds + last.endSeconds,
  };
}

export function buildTimingTrack(
  beats: ScriptBeat[],
  transcriptions: Map<string, TranscribeResult>,
  bedDurations: Map<string, number> = new Map()
): TimingEntry[] {
  const timing: TimingEntry[] = [];
  let cursorSeconds = 0;

  for (const beat of beats) {
    if (beat.type === "narration") {
      const transcribeResult = transcriptions.get(beat.id);
      if (!transcribeResult) {
        throw new Error(`missing transcription for narration beat ${beat.id}`);
      }
      const entry = extractBeatTiming(beat, transcribeResult, cursorSeconds);
      timing.push(entry);
      cursorSeconds = entry.endSeconds;
    } else if (beat.type === "silence") {
      const entry: TimingEntry = {
        beatId: beat.id,
        startSeconds: cursorSeconds,
        endSeconds: cursorSeconds + beat.duration,
      };
      timing.push(entry);
      cursorSeconds = entry.endSeconds;
    } else {
      // A bed beat's real duration comes from its audio asset, which this
      // module doesn't probe — the caller supplies it, having already read
      // the file, if known. Unknown duration degrades to a zero-length
      // marker rather than guessing or failing the whole timeline.
      const duration = bedDurations.get(beat.id) ?? 0;
      const entry: TimingEntry = {
        beatId: beat.id,
        startSeconds: cursorSeconds,
        endSeconds: cursorSeconds + duration,
      };
      timing.push(entry);
      cursorSeconds = entry.endSeconds;
    }
  }

  return timing;
}
