import type { Cue } from "./cues.js";

/**
 * Seconds to a caption timestamp.
 *
 * This lives here rather than in src/timing/frames.ts deliberately. That file
 * asks any new seconds conversion to justify itself, and its two conversions
 * are both to *frames*; this one is to milliseconds, for a text format that
 * knows nothing about fps. Adding it there would make "the only two
 * conversions" false without making anything simpler.
 *
 * Rounds rather than truncates. buildTimingTrack accumulates
 * `cursorSeconds = entry.endSeconds`, so a real span can arrive as
 * 8.699999999999998, which truncation would render as 08.699.
 */
function formatTimestamp(seconds: number, msSeparator: string): string {
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = (totalMs - ms) / 1000;
  const s = totalSeconds % 60;
  const totalMinutes = (totalSeconds - s) / 60;
  const m = totalMinutes % 60;
  const h = (totalMinutes - m) / 60;

  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${msSeparator}${pad(ms, 3)}`;
}

/** WebVTT: a header, then blank-line-separated cues with `.` before the ms. */
export function formatVtt(cues: Cue[]): string {
  const blocks = cues.map(
    (cue) =>
      `${formatTimestamp(cue.startSeconds, ".")} --> ${formatTimestamp(cue.endSeconds, ".")}\n` +
      `${cue.text}\n`
  );
  return `WEBVTT\n${blocks.map((block) => `\n${block}`).join("")}`;
}

/** SRT: no header, 1-based indices, `,` before the ms. */
export function formatSrt(cues: Cue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n` +
        `${formatTimestamp(cue.startSeconds, ",")} --> ${formatTimestamp(cue.endSeconds, ",")}\n` +
        `${cue.text}\n`
    )
    .join("\n");
}
