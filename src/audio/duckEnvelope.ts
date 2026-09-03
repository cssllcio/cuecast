/**
 * How long the gain takes to travel between full and `duckTo`.
 *
 * Mechanism, not taste. The spec (§3) puts the *level* in the author's hands
 * and keeps the ramp here, because how far a bed drops is a per-product
 * judgement and how it gets there is not.
 */
export const DUCK_RAMP_SECONDS = 0.25;

export interface Span {
  startSeconds: number;
  endSeconds: number;
}

/**
 * The gain curve for one bed beat, as a function of seconds since the bed
 * started.
 *
 * Gain is the MINIMUM of a per-span envelope, each of which already lies in
 * [duckTo, 1] (see spanGain) — so is their minimum, with no clamp needed.
 * That formulation is what makes the awkward cases fall out instead of
 * needing special cases:
 *
 *   - Contiguous ducked beats. Narration beats abut exactly, so two
 *     consecutively ducked beats must read as one region; taking the minimum
 *     never lets the gain rise in the zero-width gap between them.
 *   - Crossing ramps. Two spans closer than two ramps have overlapping
 *     ramps; taking the minimum keeps the result inside [duckTo, 1] and
 *     monotonic.
 *   - Bed edges. The returned function is only ever called with seconds
 *     inside the bed, so the part of a ramp that falls BEFORE the bed
 *     starts or AFTER it ends is never sampled — but a ramp that starts
 *     before the bed and finishes inside it (e.g. a bed placed right after
 *     the beat it ducks: the bed opens fully ducked and ramps up) has its
 *     in-bed portion sampled like any other span. Only spans that start
 *     inside the bed have their whole ramp unconditionally visible.
 *
 * Evaluated in SECONDS, deliberately. src/timing/frames.ts declares its two
 * conversions the only ones in the codebase, and a seconds-domain envelope
 * adds no third rounding rule.
 */
export function buildDuckEnvelope(
  bedStartSeconds: number,
  duckSpans: Span[],
  duckTo: number
): (secondsIntoBed: number) => number {
  return (secondsIntoBed: number) => {
    const seconds = bedStartSeconds + secondsIntoBed;

    let gain = 1;
    for (const span of duckSpans) {
      gain = Math.min(gain, spanGain(seconds, span, duckTo));
    }

    // No extra clamp needed: every spanGain return, and the starting gain
    // of 1, already lies in [duckTo, 1] — that range is a property of
    // spanGain itself, not something this function has to re-enforce.
    return gain;
  };
}

function spanGain(seconds: number, span: Span, duckTo: number): number {
  const attackStart = span.startSeconds - DUCK_RAMP_SECONDS;
  const releaseEnd = span.endSeconds + DUCK_RAMP_SECONDS;

  if (seconds <= attackStart || seconds >= releaseEnd) return 1;
  if (seconds >= span.startSeconds && seconds <= span.endSeconds) return duckTo;

  if (seconds < span.startSeconds) {
    const progress = (seconds - attackStart) / DUCK_RAMP_SECONDS;
    return 1 - progress * (1 - duckTo);
  }

  const progress = (seconds - span.endSeconds) / DUCK_RAMP_SECONDS;
  return 1 - (1 - progress) * (1 - duckTo);
}
