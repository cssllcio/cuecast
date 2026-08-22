// Seconds-to-frames conversions. There are two, with deliberately different
// rounding, because they answer different questions:
//
//   secondsToFrame          — WHERE on the timeline does something sit, or
//                             HOW LONG does a beat's own span last? Nearest
//                             frame. Rounding up here would start every beat
//                             a frame late; rounding down would end it early.
//
//   secondsToDurationFrames — HOW MANY frames must the whole composition
//                             have? Always round up, so the last partial
//                             frame of content is rendered, never cut off.
//
// Keep these as the only two conversions in the codebase; a bare
// Math.round/Math.ceil on a seconds value elsewhere is the inconsistency
// issue #5 was about.

export function secondsToFrame(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

export function secondsToDurationFrames(seconds: number, fps: number): number {
  return Math.ceil(seconds * fps);
}
