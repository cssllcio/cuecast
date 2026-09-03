import type { NarrationBeat } from "../schema/videoScript.js";

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

// NUL, because ids are unvalidated strings and most printable separators
// collide: under a space, ("a b","c") and ("a","b c") key identically.
// NUL is not a complete fix, though — `& 0xff` below truncates every UTF-16
// code unit to its low byte, so a character whose low byte happens to be
// 0x00 (U+0100, U+0200, …) is indistinguishable from this separator too:
// beatSeed("aĀ", "b") === beatSeed("a", " b"). That residual case is
// benign, not exploitable: the two colliding beats still have different
// `text`/`spoken` content, so they still produce different audio even
// though the seed that generated it is shared.
const SEPARATOR = String.fromCharCode(0);

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function beatSeed(videoId: string, beatId: string): number {
  const key = videoId + SEPARATOR + beatId;
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < key.length; i += 1) {
    // & 0xff truncates to the low byte — see the SEPARATOR comment above
    // for the (benign) collision this causes with characters like U+0100.
    hash ^= key.charCodeAt(i) & 0xff;
    // Math.imul keeps the multiply in 32-bit; a plain * loses precision
    // above 2^53 and would make the hash platform-sensitive.
    hash = Math.imul(hash, FNV_PRIME);
  }
  // >>> 0 to unsigned, then drop the sign bit: Voicebox requires seed >= 0.
  return (hash >>> 0) & 0x7fffffff;
}

/**
 * The seed a narration beat actually resolves to: an authored override when
 * present, otherwise the beat's derived identity seed. Pulled out of
 * scripts/render-video.ts (untested — `npm test` is `vitest run src`, so
 * `scripts/` is not covered) because `beat.seed ?? beatSeed(...)` and
 * `beat.seed || beatSeed(...)` type-check identically but disagree on an
 * authored seed of 0 — the same bug shape as the dead-lexicon
 * `beat.spoken || applyLexicon(...)` bug (design §5).
 */
export function resolveBeatSeed(beat: NarrationBeat, videoId: string): number {
  return beat.seed ?? beatSeed(videoId, beat.id);
}
