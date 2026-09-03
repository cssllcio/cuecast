/**
 * The default seed for a narration beat, derived from its identity.
 *
 * FNV-1a, 32-bit, masked to 31 bits. Hand-rolled rather than taken from a
 * dependency or from anything environment-provided because this output must be
 * stable across Node versions and platforms *forever*: it is what makes an
 * unchanged video.json reproduce, and changing it invalidates the
 * reproducibility of every render ever made without anything announcing it.
 * Golden values are pinned in the test for exactly that reason.
 *
 * Keyed on identity rather than position, unlike Vibrai's vo.sh
 * (SEED_BASE + line index). Inserting a beat there re-rolls every beat after
 * it; here, where the output *is* the timing, that would make a one-line edit
 * re-render the whole remainder of the video.
 */

// NUL, because ids are unvalidated strings and any printable separator
// collides: under a space, ("a b","c") and ("a","b c") key identically.
const SEPARATOR = String.fromCharCode(0);

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function beatSeed(videoId: string, beatId: string): number {
  const key = videoId + SEPARATOR + beatId;
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i) & 0xff;
    // Math.imul keeps the multiply in 32-bit; a plain * loses precision
    // above 2^53 and would make the hash platform-sensitive.
    hash = Math.imul(hash, FNV_PRIME);
  }
  // >>> 0 to unsigned, then drop the sign bit: Voicebox requires seed >= 0.
  return (hash >>> 0) & 0x7fffffff;
}
