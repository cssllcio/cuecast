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
 * Gain is the MINIMUM of a per-span envelope, clamped to [duckTo, 1]. That
 * formulation is what makes the awkward cases fall out instead of needing
 * special cases:
 *
 *   - Contiguous ducked beats. Narration beats abut exactly, so two
 *     consecutively ducked beats must read as one region; taking the minimum
 *     never lets the gain rise in the zero-width gap between them.
 *   - Crossing ramps. Two spans closer than two ramps have overlapping
 *     ramps; min-then-clamp keeps the result inside [duckTo, 1].
 *   - Bed edges. A ramp extending past either end of the bed is simply never
 *     sampled, because the returned function is only ever called with
 *     seconds inside the bed.
 *
 * Evaluated in SECONDS, deliberately. src/timing/frames.ts declares its two
 * conversions the only ones in the codebase, and a seconds-domain envelope
 * adds no third rounding rule.
 */
export function buildDuckEnvelope(
  bedSpan: Span,
  duckSpans: Span[],
  duckTo: number
): (secondsIntoBed: number) => number {
  return (secondsIntoBed: number) => {
    const seconds = bedSpan.startSeconds + secondsIntoBed;

    let gain = 1;
    for (const span of duckSpans) {
      gain = Math.min(gain, spanGain(seconds, span, duckTo));
    }

    return Math.min(1, Math.max(duckTo, gain));
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
