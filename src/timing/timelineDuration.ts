import type { TimingEntry } from "../schema/videoScript.js";

// The fallback length for a composition with no real timing to measure —
// an empty `timing` array, or every entry ending at (or before) zero. Kept
// as a named constant rather than a bare 5 at each call site.
export const DEFAULT_DURATION_SECONDS = 5;

// The video's length is the MAX over every entry's endSeconds, not the last
// entry in array order (design §2): bed entries float over the narration/
// silence spine and can end at or before the spine's end while still being
// last in the script's array order. Both Root.tsx (Composition defaultProps)
// and scripts/render-video.ts (the real render) need this, and both used to
// read `timing.at(-1)` or guard only on `timing.length`, which passes an
// all-bed script straight through to a zero-length composition — every bed
// in a bed-only script clamps to {start: 0, end: 0} against an empty spine.
export function timelineDurationSeconds(timing: TimingEntry[]): number {
  if (timing.length === 0) return DEFAULT_DURATION_SECONDS;
  const maxEndSeconds = Math.max(...timing.map((entry) => entry.endSeconds));
  return maxEndSeconds > 0 ? maxEndSeconds : DEFAULT_DURATION_SECONDS;
}
