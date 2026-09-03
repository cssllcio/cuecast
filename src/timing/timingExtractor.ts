import type { NarrationBeat, ScriptBeat, TimingEntry } from "../schema/videoScript.js";

export function extractBeatTiming(
  beat: NarrationBeat,
  durationSeconds: number,
  offsetSeconds: number
): TimingEntry {
  return {
    beatId: beat.id,
    startSeconds: offsetSeconds,
    endSeconds: offsetSeconds + durationSeconds,
  };
}

// Lays beats out back-to-back on one timeline. `durations` holds the real
// audio length, in seconds, for every beat that has audio: narration beats
// (from the completed /generate response) and bed beats (probed from the
// supplied file). Silence beats carry their own authored duration.
//
// A narration beat with no duration is an error — its audio was never
// generated. A bed beat with no duration degrades to a zero-length marker
// rather than failing the whole timeline.
export function buildTimingTrack(
  beats: ScriptBeat[],
  durations: Map<string, number>
): TimingEntry[] {
  const timing: TimingEntry[] = [];
  let cursorSeconds = 0;

  for (const beat of beats) {
    let entry: TimingEntry;

    if (beat.type === "narration") {
      const duration = durations.get(beat.id);
      if (duration === undefined) {
        throw new Error(`missing duration for narration beat ${beat.id}`);
      }
      entry = extractBeatTiming(beat, duration, cursorSeconds);
    } else if (beat.type === "silence") {
      entry = {
        beatId: beat.id,
        startSeconds: cursorSeconds,
        endSeconds: cursorSeconds + beat.duration,
      };
    } else {
      entry = {
        beatId: beat.id,
        startSeconds: cursorSeconds,
        endSeconds: cursorSeconds + (durations.get(beat.id) ?? 0),
      };
    }

    timing.push(entry);
    cursorSeconds = entry.endSeconds;
  }

  return timing;
}

// Attaches each entry's real audio path and the seed that produced it
// (design §4), so a rendered artifact is self-describing without
// re-deriving anything. Pulled out of scripts/render-video.ts (untested —
// `npm test` is `vitest run src`, so `scripts/` is not covered) specifically
// to prove a `bed`/`silence` beat — absent from both maps — comes out with
// NO `seed` key at all, not `seed: undefined`, which JSON.stringify would
// still serialize into the generated artifact.
export function decorateTimingTrack(
  timing: TimingEntry[],
  audioPaths: Map<string, string>,
  seeds: Map<string, number>
): TimingEntry[] {
  return timing.map((entry) => {
    const audioPath = audioPaths.get(entry.beatId);
    const seed = seeds.get(entry.beatId);
    return {
      ...entry,
      ...(audioPath ? { audioPath } : {}),
      ...(seed !== undefined ? { seed } : {}),
    };
  });
}
