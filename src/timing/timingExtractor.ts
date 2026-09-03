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

// Lays beats out on one timeline. `durations` holds the real audio length,
// in seconds, for every beat that has audio: narration beats (from the
// completed /generate response) and bed beats (probed from the supplied
// file). Silence beats carry their own authored duration.
//
// The invariant, which changed when ducking landed: narration and silence
// entries are contiguous and gapless and together define the video's length
// — call that the spine. Bed entries float over the spine and do not extend
// it: a bed starts where it sits in the script and does NOT advance the
// cursor, so the narration that follows overlaps it. That overlap is what
// makes ducking expressible at all; while every beat advanced the cursor, a
// bed had its own exclusive slot and could never play under anything.
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
    if (beat.type === "bed") {
      timing.push({
        beatId: beat.id,
        startSeconds: cursorSeconds,
        endSeconds: cursorSeconds + (durations.get(beat.id) ?? 0),
      });
      continue; // deliberately does not advance the cursor
    }

    let entry: TimingEntry;
    if (beat.type === "narration") {
      const duration = durations.get(beat.id);
      if (duration === undefined) {
        throw new Error(`missing duration for narration beat ${beat.id}`);
      }
      entry = extractBeatTiming(beat, duration, cursorSeconds);
    } else {
      entry = {
        beatId: beat.id,
        startSeconds: cursorSeconds,
        endSeconds: cursorSeconds + beat.duration,
      };
    }

    timing.push(entry);
    cursorSeconds = entry.endSeconds;
  }

  // Second pass: a bed does not get to decide how long the video is. Only
  // bed entries can exceed the spine, since every other entry ends at the
  // cursor. Spread rather than rebuild: `entry` here is the source of truth
  // for its own fields — decorateTimingTrack (which attaches audioPath and
  // seed) always runs after this, on this function's own return value, so
  // there is no separately-attached field to lose (design §2).
  const spineEndSeconds = cursorSeconds;
  return timing.map((entry) =>
    entry.endSeconds > spineEndSeconds
      ? { ...entry, endSeconds: spineEndSeconds }
      : entry
  );
}

export interface BedClamp {
  beatId: string;
  requestedSeconds: number;
  actualSeconds: number;
}

// Which bed beats lost audio to the clamp, and how much. The pipeline prints
// these; a bed cut from 60s to 10s silently is the same class of failure as
// issue #1's dropped narration, and the lossy case is far likelier than a
// bed clamped all the way to zero.
export function describeBedClamps(
  beats: ScriptBeat[],
  durations: Map<string, number>,
  timing: TimingEntry[]
): BedClamp[] {
  const clamps: BedClamp[] = [];

  for (const beat of beats) {
    if (beat.type !== "bed") continue;
    const requestedSeconds = durations.get(beat.id) ?? 0;
    // buildTimingTrack emits exactly one entry per beat in `beats`, and
    // `timing` is only ever that function's own output, so a bed beat's
    // entry always exists here.
    const entry = timing.find((candidate) => candidate.beatId === beat.id)!;

    const actualSeconds = entry.endSeconds - entry.startSeconds;
    // Float tolerance: these are sums of floating-point durations, so an
    // exact `<` would report phantom clamps of a few nanoseconds.
    if (actualSeconds < requestedSeconds - 1e-9) {
      clamps.push({ beatId: beat.id, requestedSeconds, actualSeconds });
    }
  }

  return clamps;
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
