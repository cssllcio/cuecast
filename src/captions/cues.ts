import type { VideoScript } from "../schema/videoScript.js";

export interface Cue {
  startSeconds: number;
  endSeconds: number;
  /** What a viewer reads. Never a beat's `spoken` respelling. */
  text: string;
}

/**
 * The caption track for a rendered script.
 *
 * Joins `timing` to `script` on `beatId` and keeps only narration beats.
 * `silence` and `bed` entries carry no `text` at all, so index alignment is
 * not available — and skipping them is also what gives the caption track real
 * gaps where the video is silent, instead of the abutting spans the timeline
 * itself produces.
 *
 * Cues come out in timeline order without sorting: narration entries are laid
 * out contiguously by buildTimingTrack, so they are already ascending. Bed
 * entries float over that spine and can appear out of order, but they are
 * dropped here.
 */
export function buildCues(videoScript: VideoScript): Cue[] {
  const textByBeatId = new Map<string, string>();
  for (const beat of videoScript.script) {
    if (beat.type === "narration") {
      textByBeatId.set(beat.id, beat.text);
    }
  }

  const cues: Cue[] = [];
  for (const entry of videoScript.timing) {
    const text = textByBeatId.get(entry.beatId);
    if (text === undefined) continue;
    cues.push({
      startSeconds: entry.startSeconds,
      endSeconds: entry.endSeconds,
      text,
    });
  }
  return cues;
}
