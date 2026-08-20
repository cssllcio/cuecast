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
  transcriptions: Map<string, TranscribeResult>
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
      timing.push({
        beatId: beat.id,
        startSeconds: cursorSeconds,
        endSeconds: cursorSeconds,
      });
    }
  }

  return timing;
}
