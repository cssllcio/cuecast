# Ducking (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a `bed` beat play *underneath* narration at a reduced level, which the timeline cannot currently express at all.

**Architecture:** Bed beats stop advancing the timeline cursor, so they overlap the narration that follows instead of occupying an exclusive slot. A pure envelope function turns a bed's `duck` list into a gain curve, and the Remotion composition passes that curve to `<Audio volume>`.

**Tech Stack:** TypeScript 5 (strict), Vitest 2, Zod 3, Remotion 4, Node >= 20. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-02-cuecast-ducking-cli-captions-design.md` — this plan implements **Phase 1 only** (spec §2 and §3). The CLI/compile/paths work (§4) and captions (§5) get their own plans.

## Global Constraints

- **Base this work on `main` with PR #12 merged.** Task 2 edits `buildTimingTrack`, which #12 also touched, and relies on `decorateTimingTrack` existing as a separate function. If #12 is unmerged, stop and say so.
- Ducking is **mechanism only — no product-specific preset lives in this repo** (spec §3). The level is authored; the ramp is a code constant. There is deliberately no default `duckTo`.
- `duckTo` is a linear gain in `(0, 1]`, matching Remotion's `<Audio volume>` domain — not dB.
- The envelope is evaluated in **seconds, never frames**. `src/timing/frames.ts` states its two conversions are the only ones in the codebase; that note exists because of issue #5.
- `bed` and `silence` beats never reach the TTS, and their timing entries must never gain a `seed`. #12 established and tested that; do not regress it.
- Unit tests (`npm test`, i.e. `vitest run src`) must never require a running service. Anything needing Chrome or ffmpeg goes in `test/render/`.
- Nothing under `scripts/` is covered by `npm test`. Logic that needs testing belongs in `src/`.

## File Structure

| File | Responsibility |
|---|---|
| `src/schema/videoScript.ts` (modify) | `duckTo` on a bed beat; cross-field validation of `duck`. |
| `src/timing/timingExtractor.ts` (modify) | Beds become a parallel lane; clamp to the spine; describe clamps for reporting. |
| `src/audio/duckEnvelope.ts` (create) | The gain curve. Pure, seconds-domain, no Remotion import. |
| `src/remotion/CuecastComposition.tsx` (modify) | Build per-sequence volume; pass it to `<Audio>`. |
| `src/remotion/Root.tsx`, `scripts/render-video.ts` (modify) | Composition length becomes `Math.max`, not `.at(-1)`. |
| `test/fixtures/duck-proof-video.json` (create) | Hand-authored timing for the render proof — no TTS needed. |
| `test/render/duck.render.test.ts` (create) | Measures a ducked window against an open one. |

---

## Task 1: Schema — `duckTo`, and a duck that cannot be mis-authored

**Files:**
- Modify: `src/schema/videoScript.ts`
- Test: `src/schema/videoScript.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BedBeat.duckTo?: number` (linear gain in `(0,1]`), consumed by Tasks 3 and 4. Parse-time guarantees that later tasks rely on: a non-empty `duck` always has a `duckTo`, and every id in `duck` names an existing narration beat.

- [ ] **Step 1: Write the failing test**

Append to `src/schema/videoScript.test.ts`. The existing `validScript` const at the top of that file is reused; `validScript.script[0]` is narration beat `beat_01`, `script[1]` is silence beat `beat_02`.

```ts
describe("duck", () => {
  const bedScript = (bed: Record<string, unknown>) => ({
    ...validScript,
    script: [...validScript.script, { id: "music", type: "bed", audio: "m.wav", ...bed }],
  });

  it("accepts a bed beat with no duck at all", () => {
    expect(() => parseVideoScript(bedScript({}))).not.toThrow();
  });

  it("accepts an empty duck list without requiring duckTo", () => {
    expect(() => parseVideoScript(bedScript({ duck: [] }))).not.toThrow();
  });

  it("accepts a duck naming a real narration beat when duckTo is given", () => {
    const parsed = parseVideoScript(
      bedScript({ duck: ["beat_01"], duckTo: 0.25 })
    );
    expect(parsed.script[2]).toMatchObject({ duck: ["beat_01"], duckTo: 0.25 });
  });

  // The spec forbids a product-specific preset living in this repo, and a
  // default gain IS a preset — so there is nothing to fall back on and the
  // author must state the level.
  it("rejects a non-empty duck with no duckTo", () => {
    expect(() => parseVideoScript(bedScript({ duck: ["beat_01"] }))).toThrow(
      /duckTo/
    );
  });

  // A typo'd id would otherwise duck nothing at all, silently — the failure
  // shape this repo hit with issue #1 and the dead lexicon.
  it("rejects a duck naming a beat that does not exist", () => {
    expect(() =>
      parseVideoScript(bedScript({ duck: ["beat_99"], duckTo: 0.25 }))
    ).toThrow(/beat_99/);
  });

  it("rejects a duck naming a silence beat", () => {
    expect(() =>
      parseVideoScript(bedScript({ duck: ["beat_02"], duckTo: 0.25 }))
    ).toThrow(/beat_02/);
  });

  it("rejects a duckTo outside (0, 1]", () => {
    for (const bad of [0, -0.1, 1.5]) {
      expect(() =>
        parseVideoScript(bedScript({ duck: ["beat_01"], duckTo: bad }))
      ).toThrow();
    }
  });

  it("accepts a duckTo of exactly 1", () => {
    expect(() =>
      parseVideoScript(bedScript({ duck: ["beat_01"], duckTo: 1 }))
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/schema/videoScript.test.ts`
Expected: FAIL — the rejection cases do not throw (zod strips unknown keys rather than validating them), and `toMatchObject` finds no `duckTo`.

- [ ] **Step 3: Add the field**

In `src/schema/videoScript.ts`, extend `bedBeatSchema`:

```ts
const bedBeatSchema = z.object({
  id: z.string(),
  type: z.literal("bed"),
  audio: z.string(),
  duck: z.array(z.string()).optional(),
  // Linear gain, matching Remotion's <Audio volume> domain rather than dB.
  // Required whenever `duck` is non-empty — see the superRefine below. There
  // is deliberately no default: the spec forbids a product-specific ducking
  // preset living in this repo, and a default gain is exactly that.
  duckTo: z.number().gt(0).lte(1).optional(),
});
```

- [ ] **Step 4: Add the cross-field validation**

Still in `src/schema/videoScript.ts`. These checks span two beats, so they belong on the whole script rather than on `bedBeatSchema`. Attach a `superRefine` to `videoScriptSchema` — replace the existing `const videoScriptSchema = z.object({ ... });` closing line so the object is followed by the refinement:

```ts
const videoScriptSchema = z
  .object({
    id: z.string(),
    diagram: z.object({
      source: z.string(),
      revealGroups: z.record(z.array(z.string())),
    }),
    script: z.array(scriptBeatSchema),
    pronunciations: z.record(z.string()),
    timing: z.array(timingEntrySchema),
  })
  .superRefine((script, ctx) => {
    const narrationIds = new Set(
      script.script.filter((beat) => beat.type === "narration").map((beat) => beat.id)
    );

    script.script.forEach((beat, index) => {
      if (beat.type !== "bed") return;
      const duck = beat.duck ?? [];
      if (duck.length === 0) return;

      if (beat.duckTo === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["script", index, "duckTo"],
          message: `bed beat "${beat.id}" ducks ${duck.length} beat(s) but sets no duckTo; state the level explicitly`,
        });
      }

      for (const target of duck) {
        if (!narrationIds.has(target)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["script", index, "duck"],
            message: `bed beat "${beat.id}" ducks "${target}", which is not a narration beat id`,
          });
        }
      }
    });
  });
```

Note the existing `export type VideoScript = z.infer<typeof videoScriptSchema>;` and `parseVideoScript` need no change — `z.infer` sees through the refinement.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/schema/videoScript.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full unit suite and typecheck**

Run: `npm test && npm run build`
Expected: PASS and clean. Other suites construct video scripts; the new refinement must not reject any existing fixture.

- [ ] **Step 7: Commit**

```bash
git add src/schema/videoScript.ts src/schema/videoScript.test.ts
git commit -m "feat: add duckTo and validate a bed beat's duck targets"
```

---

## Task 2: Beds become a parallel lane

**Files:**
- Modify: `src/timing/timingExtractor.ts`
- Modify: `src/remotion/Root.tsx`
- Modify: `scripts/render-video.ts`
- Test: `src/timing/timingExtractor.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `buildTimingTrack` with unchanged signature but new semantics (beds do not advance the cursor, and are clamped to the spine), plus `describeBedClamps(beats: ScriptBeat[], durations: Map<string, number>, timing: TimingEntry[]): BedClamp[]` where `BedClamp` is `{ beatId: string; requestedSeconds: number; actualSeconds: number }`. Task 4 relies on bed and narration spans overlapping.

- [ ] **Step 1: Write the failing test**

Append to `src/timing/timingExtractor.test.ts`:

```ts
describe("bed beats as a parallel lane", () => {
  const narration = (id: string): ScriptBeat => ({
    id,
    type: "narration",
    text: "t",
    spoken: "t",
  });

  it("does not let a bed advance the cursor", () => {
    const beats: ScriptBeat[] = [
      { id: "music", type: "bed", audio: "m.wav" },
      narration("beat_01"),
    ];
    const durations = new Map([["music", 6], ["beat_01", 2]]);

    const timing = buildTimingTrack(beats, durations);

    // The narration starts at 0, not after the bed — that overlap is the
    // whole point: a bed that occupied its own slot could never be ducked.
    expect(timing).toEqual([
      { beatId: "music", startSeconds: 0, endSeconds: 2 },
      { beatId: "beat_01", startSeconds: 0, endSeconds: 2 },
    ]);
  });

  it("clamps a bed that outlasts the spine", () => {
    const beats: ScriptBeat[] = [
      { id: "music", type: "bed", audio: "m.wav" },
      narration("beat_01"),
    ];
    // 60s of music over a 2s spine.
    const timing = buildTimingTrack(beats, new Map([["music", 60], ["beat_01", 2]]));

    expect(timing[0]).toEqual({ beatId: "music", startSeconds: 0, endSeconds: 2 });
  });

  it("still lays narration and silence back to back", () => {
    const beats: ScriptBeat[] = [
      narration("beat_01"),
      { id: "gap", type: "silence", duration: 1 },
      narration("beat_02"),
    ];
    const timing = buildTimingTrack(
      beats,
      new Map([["beat_01", 2], ["beat_02", 3]])
    );

    expect(timing).toEqual([
      { beatId: "beat_01", startSeconds: 0, endSeconds: 2 },
      { beatId: "gap", startSeconds: 2, endSeconds: 3 },
      { beatId: "beat_02", startSeconds: 3, endSeconds: 6 },
    ]);
  });

  it("gives a bed placed after the last narration beat zero length", () => {
    const beats: ScriptBeat[] = [
      narration("beat_01"),
      { id: "outro", type: "bed", audio: "m.wav" },
    ];
    const timing = buildTimingTrack(beats, new Map([["beat_01", 2], ["outro", 5]]));

    expect(timing[1]).toEqual({ beatId: "outro", startSeconds: 2, endSeconds: 2 });
  });
});

describe("describeBedClamps", () => {
  it("reports a bed whose audio was cut short, with both durations", () => {
    const beats: ScriptBeat[] = [
      { id: "music", type: "bed", audio: "m.wav" },
      { id: "beat_01", type: "narration", text: "t", spoken: "t" },
    ];
    const durations = new Map([["music", 60], ["beat_01", 2]]);
    const timing = buildTimingTrack(beats, durations);

    expect(describeBedClamps(beats, durations, timing)).toEqual([
      { beatId: "music", requestedSeconds: 60, actualSeconds: 2 },
    ]);
  });

  it("reports nothing when every bed fits", () => {
    const beats: ScriptBeat[] = [
      { id: "music", type: "bed", audio: "m.wav" },
      { id: "beat_01", type: "narration", text: "t", spoken: "t" },
    ];
    const durations = new Map([["music", 2], ["beat_01", 5]]);
    const timing = buildTimingTrack(beats, durations);

    expect(describeBedClamps(beats, durations, timing)).toEqual([]);
  });
});
```

Add `describeBedClamps` to the existing import from `./timingExtractor.js` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/timing/timingExtractor.test.ts`
Expected: FAIL — the narration beat currently starts at 6 (after the bed), and `describeBedClamps` does not exist.

Existing tests in this file that assert beds advancing the cursor will also fail. That is correct: they encode the old invariant. Update them to the new one rather than working around them.

- [ ] **Step 3: Rewrite `buildTimingTrack` as two passes**

In `src/timing/timingExtractor.ts`, replace the header comment and the function body:

```ts
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
  // cursor. Spread rather than rebuild, so any field a caller already
  // attached survives.
  const spineEndSeconds = cursorSeconds;
  return timing.map((entry) =>
    entry.endSeconds > spineEndSeconds
      ? { ...entry, endSeconds: spineEndSeconds }
      : entry
  );
}
```

- [ ] **Step 4: Add `describeBedClamps`**

Append to `src/timing/timingExtractor.ts`:

```ts
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
    const entry = timing.find((candidate) => candidate.beatId === beat.id);
    if (entry === undefined) continue;

    const actualSeconds = entry.endSeconds - entry.startSeconds;
    // Float tolerance: these are sums of floating-point durations, so an
    // exact `<` would report phantom clamps of a few nanoseconds.
    if (actualSeconds < requestedSeconds - 1e-9) {
      clamps.push({ beatId: beat.id, requestedSeconds, actualSeconds });
    }
  }

  return clamps;
}
```

- [ ] **Step 5: Fix both composition-length call sites**

Both currently read the last entry in *array* order, which is a bed whenever a script ends with one — and a bed's end is at or before the spine's, so the video would be cut short.

In `src/remotion/Root.tsx`, replace:

```tsx
  const lastTiming = videoScript.timing.at(-1);
  const durationInSeconds = lastTiming?.endSeconds ?? 5;
```

with:

```tsx
  // Max over all entries, not the last one: bed entries float over the spine
  // and can appear last in the array while ending earlier.
  const durationInSeconds = videoScript.timing.length
    ? Math.max(...videoScript.timing.map((entry) => entry.endSeconds))
    : 5;
```

In `scripts/render-video.ts`, replace:

```ts
      durationInFrames: secondsToDurationFrames(
        finalVideoScript.timing.at(-1)?.endSeconds ?? 5,
        composition.fps
      ),
```

with:

```ts
      durationInFrames: secondsToDurationFrames(
        finalVideoScript.timing.length
          ? Math.max(...finalVideoScript.timing.map((entry) => entry.endSeconds))
          : 5,
        composition.fps
      ),
```

- [ ] **Step 6: Report clamps from the pipeline**

In `scripts/render-video.ts`, add `describeBedClamps` to the existing import from `../src/timing/timingExtractor.js`, and immediately after the `const timing = decorateTimingTrack(...)` block insert:

```ts
  for (const clamp of describeBedClamps(videoScript.script, durations, timing)) {
    console.error(
      `cuecast: bed beat "${clamp.beatId}" was cut from ${clamp.requestedSeconds.toFixed(2)}s ` +
        `to ${clamp.actualSeconds.toFixed(2)}s — it outlasts the narration it plays under`
    );
  }
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test && npm run build`
Expected: PASS and clean.

- [ ] **Step 8: Commit**

```bash
git add src/timing/timingExtractor.ts src/timing/timingExtractor.test.ts src/remotion/Root.tsx scripts/render-video.ts
git commit -m "feat: float bed beats over the narration spine instead of after it"
```

---

## Task 3: The duck envelope

**Files:**
- Create: `src/audio/duckEnvelope.ts`
- Test: `src/audio/duckEnvelope.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export const DUCK_RAMP_SECONDS: number;
  export interface Span { startSeconds: number; endSeconds: number }
  export function buildDuckEnvelope(
    bedSpan: Span,
    duckSpans: Span[],
    duckTo: number
  ): (secondsIntoBed: number) => number;
  ```
  Task 4 calls this.

- [ ] **Step 1: Write the failing test**

Every expected value below was computed by running the Step 3 implementation. If a value disagrees, the implementation is wrong — do not adjust the expectation.

```ts
// src/audio/duckEnvelope.test.ts
import { describe, expect, it } from "vitest";
import { buildDuckEnvelope, DUCK_RAMP_SECONDS } from "./duckEnvelope.js";

const BED = { startSeconds: 0, endSeconds: 10 };

describe("buildDuckEnvelope", () => {
  it("is flat at full gain when nothing ducks the bed", () => {
    const gain = buildDuckEnvelope(BED, [], 0.25);
    for (const t of [0, 5, 10]) expect(gain(t)).toBe(1);
  });

  it("ramps down into a duck span, holds, and ramps back up", () => {
    const gain = buildDuckEnvelope(BED, [{ startSeconds: 2, endSeconds: 4 }], 0.25);

    expect(gain(0)).toBe(1);
    expect(gain(1.75)).toBe(1);      // ramp has not started
    expect(gain(1.875)).toBeCloseTo(0.625, 6); // halfway down
    expect(gain(2)).toBeCloseTo(0.25, 6);      // fully ducked
    expect(gain(3)).toBeCloseTo(0.25, 6);
    expect(gain(4)).toBeCloseTo(0.25, 6);
    expect(gain(4.125)).toBeCloseTo(0.625, 6); // halfway back
    expect(gain(4.25)).toBe(1);
    expect(gain(10)).toBe(1);
  });

  // Narration beats abut exactly, so two consecutively ducked beats must read
  // as ONE duck region. A per-span envelope applied sequentially would ramp
  // back to full in the zero-width gap and produce an audible blip.
  it("does not rise between two contiguous duck spans", () => {
    const gain = buildDuckEnvelope(
      BED,
      [
        { startSeconds: 2, endSeconds: 4 },
        { startSeconds: 4, endSeconds: 6 },
      ],
      0.25
    );

    for (const t of [3.9, 4, 4.1, 5, 6]) {
      expect(gain(t)).toBeCloseTo(0.25, 6);
    }
  });

  it("stays in range when two ramps cross", () => {
    // Gap of 0.2s, shorter than two ramps (2 x 0.25s), so the release of the
    // first overlaps the attack of the second.
    const gain = buildDuckEnvelope(
      BED,
      [
        { startSeconds: 2, endSeconds: 3 },
        { startSeconds: 3.2, endSeconds: 4 },
      ],
      0.25
    );

    expect(gain(3.1)).toBeCloseTo(0.55, 6);

    for (let t = 2.5; t <= 3.7; t += 0.01) {
      expect(gain(t)).toBeGreaterThanOrEqual(0.25);
      expect(gain(t)).toBeLessThanOrEqual(1);
    }
  });

  it("never samples a ramp that falls outside the bed", () => {
    // Bed starts at 3, inside a duck span that began at 2 — the attack ramp
    // sits before the bed exists and is simply never evaluated.
    const gain = buildDuckEnvelope(
      { startSeconds: 3, endSeconds: 10 },
      [{ startSeconds: 2, endSeconds: 4 }],
      0.25
    );

    expect(gain(0)).toBeCloseTo(0.25, 6);
  });

  it("exposes the ramp as a constant rather than a magic number", () => {
    expect(DUCK_RAMP_SECONDS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/audio/duckEnvelope.test.ts`
Expected: FAIL — cannot find module `./duckEnvelope.js`.

- [ ] **Step 3: Implement the envelope**

```ts
// src/audio/duckEnvelope.ts

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/audio/duckEnvelope.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/audio/duckEnvelope.ts src/audio/duckEnvelope.test.ts
git commit -m "feat: add the duck gain envelope"
```

---

## Task 4: Wire the envelope into the composition

**Files:**
- Modify: `src/remotion/CuecastComposition.tsx`
- Test: `src/remotion/CuecastComposition.test.ts`

**Interfaces:**
- Consumes: `buildDuckEnvelope`, `Span` (Task 3); `BedBeat.duckTo` (Task 1); overlapping bed/narration spans (Task 2).
- Produces: `AudioSequenceSpec` gaining `beatId: string` and `volume: number | ((frame: number) => number)`.

- [ ] **Step 1: Write the failing test**

Append to `src/remotion/CuecastComposition.test.ts`:

```ts
describe("buildAudioSequences ducking", () => {
  const script = {
    id: "v1",
    diagram: { source: "d.mmd", revealGroups: {} },
    pronunciations: {},
    script: [
      { id: "music", type: "bed" as const, audio: "m.wav", duck: ["beat_01"], duckTo: 0.25 },
      { id: "beat_01", type: "narration" as const, text: "t", spoken: "t" },
    ],
    timing: [
      { beatId: "music", startSeconds: 0, endSeconds: 4, audioPath: "audio/v1/music.wav" },
      { beatId: "beat_01", startSeconds: 1, endSeconds: 2, audioPath: "audio/v1/beat_01.wav" },
    ],
  };

  it("gives a ducked bed a volume function, and narration a plain 1", () => {
    const [bed, narration] = buildAudioSequences(script, 30);

    expect(typeof bed.volume).toBe("function");
    expect(narration.volume).toBe(1);
  });

  // Remotion hands <Audio volume> a frame relative to the Sequence, so the
  // spec has to convert with frame / fps before evaluating the envelope.
  it("evaluates the bed's volume in Sequence-relative frames", () => {
    const [bed] = buildAudioSequences(script, 30);
    const volumeAt = bed.volume as (frame: number) => number;

    expect(volumeAt(0)).toBe(1);                  // 0s — before the duck
    expect(volumeAt(45)).toBeCloseTo(0.25, 6);    // 1.5s — inside it
    expect(volumeAt(105)).toBe(1);                // 3.5s — well after
  });

  it("leaves a bed with no duck at full gain", () => {
    const plain = {
      ...script,
      script: [{ id: "music", type: "bed" as const, audio: "m.wav" }, script.script[1]],
    };
    const [bed] = buildAudioSequences(plain, 30);

    expect(bed.volume).toBe(1);
  });

  // One audio path can now produce more than one sequence, so a path-keyed
  // React list would collide and silently drop audio.
  it("carries the beat id for use as the React key", () => {
    const [bed, narration] = buildAudioSequences(script, 30);

    expect(bed.beatId).toBe("music");
    expect(narration.beatId).toBe("beat_01");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/remotion/CuecastComposition.test.ts`
Expected: FAIL — `volume` and `beatId` are not on `AudioSequenceSpec`.

- [ ] **Step 3: Extend the spec type and the builder**

In `src/remotion/CuecastComposition.tsx`, add the import:

```ts
import { buildDuckEnvelope } from "../audio/duckEnvelope.js";
```

Replace `AudioSequenceSpec` and the header comment above `buildAudioSequences` (the existing comment attributes beat durations to "Whisper's transcribed segment boundaries" — there is no transcription step, it was removed in PR #7):

```ts
export interface AudioSequenceSpec {
  beatId: string;
  audioPath: string;
  fromFrame: number;
  durationInFrames: number;
  volume: number | ((frame: number) => number);
}

// Every timing entry with an audioPath (narration audio, or a bed beat's
// supplied clip — see scripts/render-video.ts) gets its own Sequence, keyed
// to when that beat starts on the real timeline. durationInFrames bounds the
// Sequence to that beat's own timing span: a beat's timeline duration comes
// from the TTS service's reported duration for narration, or the probed file
// length for a bed — not from the audio file's own possibly-padded length —
// so leaving the Sequence unbounded would let one beat's audio bleed into
// the next beat's window.
//
// A bed beat that ducks gets a volume function instead of a constant; every
// other sequence plays at full gain. Pure, so the whole mapping is testable
// without rendering the composition.
export function buildAudioSequences(
  videoScript: VideoScript,
  fps: number
): AudioSequenceSpec[] {
  return videoScript.timing
    .filter((entry) => Boolean(entry.audioPath))
    .map((entry) => {
      const beat = videoScript.script.find((candidate) => candidate.id === entry.beatId);

      let volume: number | ((frame: number) => number) = 1;
      if (
        beat?.type === "bed" &&
        beat.duck !== undefined &&
        beat.duck.length > 0 &&
        beat.duckTo !== undefined
      ) {
        const duckSpans = beat.duck
          .map((targetId) => videoScript.timing.find((t) => t.beatId === targetId))
          .filter((span): span is NonNullable<typeof span> => span !== undefined)
          .map((span) => ({
            startSeconds: span.startSeconds,
            endSeconds: span.endSeconds,
          }));

        const envelope = buildDuckEnvelope(
          { startSeconds: entry.startSeconds, endSeconds: entry.endSeconds },
          duckSpans,
          beat.duckTo
        );
        // Remotion hands this a frame relative to the Sequence's own start.
        volume = (frame: number) => envelope(frame / fps);
      }

      return {
        beatId: entry.beatId,
        audioPath: entry.audioPath as string,
        // A position and a span on the timeline: nearest frame, not ceil —
        // see src/timing/frames.ts for why the two conversions differ.
        fromFrame: secondsToFrame(entry.startSeconds, fps),
        durationInFrames: secondsToFrame(entry.endSeconds - entry.startSeconds, fps),
        volume,
      };
    });
}
```

- [ ] **Step 4: Pass volume to `<Audio>` and key by beat id**

In the JSX of `CuecastComposition`, replace the audio-sequence block:

```tsx
      {audioSequences.map((sequence) => (
        <Sequence
          key={sequence.beatId}
          from={sequence.fromFrame}
          durationInFrames={sequence.durationInFrames}
        >
          <Audio src={staticFile(sequence.audioPath)} volume={sequence.volume} />
        </Sequence>
      ))}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run build`
Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add src/remotion/CuecastComposition.tsx src/remotion/CuecastComposition.test.ts
git commit -m "feat: duck a bed beat's audio under the narration it names"
```

---

## Task 5: Prove a duck in a real render

**Files:**
- Create: `test/fixtures/duck-proof-video.json`
- Create: `test/render/duck.render.test.ts`

**Interfaces:**
- Consumes: everything above, through a real Remotion render.
- Produces: nothing other tasks use.

This fixture hand-authors its `timing` block, exactly as `test/fixtures/render-proof-video.json` does — a deliberate test fixture standing in for generation, so the render suite needs no TTS. The narration beat carries no `audioPath` and therefore makes no sound; it exists only to give the bed something to duck against.

- [ ] **Step 1: Write the fixture**

```json
{
  "id": "duck_proof",
  "diagram": {
    "source": "test/fixtures/generic-container.mmd",
    "revealGroups": { "group_api": ["api"] }
  },
  "script": [
    { "id": "music", "type": "bed", "audio": "test/fixtures/tone.wav", "duck": ["beat_01"], "duckTo": 0.1 },
    { "id": "beat_01", "type": "narration", "text": "Quiet part.", "spoken": "Quiet part." }
  ],
  "pronunciations": {},
  "timing": [
    { "beatId": "music", "startSeconds": 0.0, "endSeconds": 3.0, "audioPath": "audio/duck_proof/music.wav" },
    { "beatId": "beat_01", "startSeconds": 1.5, "endSeconds": 2.5 }
  ]
}
```

- [ ] **Step 2: Write the failing render test**

`duckTo` is 0.1, a 20 dB drop, so the difference is unmistakable against measurement noise.

```ts
// test/render/duck.render.test.ts
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { parseVideoScript } from "../../src/schema/videoScript.js";
import { cuecastWebpackOverride } from "../../src/remotion/webpackOverride.js";

async function maxVolumeDb(file: string, startSeconds: number, seconds: number) {
  // volumedetect over a slice: a whole-file measurement cannot see a duck,
  // because the loud parts set max_volume for the entire track.
  const { stderr } = await execa("ffmpeg", [
    "-ss", String(startSeconds),
    "-t", String(seconds),
    "-i", file,
    "-af", "volumedetect",
    "-f", "null",
    "-",
  ]);
  const match = stderr.match(/max_volume:\s*(-?\d+(\.\d+)?)\s*dB/);
  expect(match).not.toBeNull();
  return Number(match?.[1]);
}

describe("bed ducking", () => {
  it("plays the bed quieter under the narration it ducks", async () => {
    const videoScript = parseVideoScript(
      JSON.parse(readFileSync("test/fixtures/duck-proof-video.json", "utf-8"))
    );

    // staticFile() resolves against public/; the fixture's audioPath points
    // there, so the tone has to exist at that path before bundling.
    mkdirSync("public/audio/duck_proof", { recursive: true });
    copyFileSync("test/fixtures/tone.wav", "public/audio/duck_proof/music.wav");

    const svgContent = readFileSync("test/fixtures/render-proof-video.svg", "utf-8");
    const inputProps = { videoScript, svgContent };

    const bundleLocation = await bundle({
      entryPoint: "src/remotion/Root.tsx",
      webpackOverride: cuecastWebpackOverride,
    });
    // inputProps must be passed here as well as to renderMedia — omitting it
    // silently falls back to Root's defaultProps (the bug PR #3 fixed).
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "Cuecast",
      inputProps,
    });

    const outputLocation = "out/duck-proof.mp4";
    await renderMedia({
      composition: { ...composition, durationInFrames: 90 },
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation,
      inputProps,
    });

    // 0.2s-0.7s: bed alone, full gain. 1.8s-2.3s: inside the duck span,
    // clear of both 0.25s ramps.
    const openDb = await maxVolumeDb(outputLocation, 0.2, 0.5);
    const duckedDb = await maxVolumeDb(outputLocation, 1.8, 0.5);

    // duckTo 0.1 is a 20 dB drop; assert well over half of it to stay clear
    // of encoder noise while still proving a real, large reduction.
    expect(openDb - duckedDb).toBeGreaterThan(12);
  });
}, 120_000);
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/render/duck.render.test.ts`
Expected: FAIL — before Task 4's volume wiring the bed plays at full gain throughout, so the two windows measure nearly the same and the difference is far below 12 dB.

If you are running this after Task 4 is already committed, confirm the test genuinely fails by temporarily reverting `volume={sequence.volume}` to no volume prop, watching it fail, then restoring it. A render proof you never saw fail proves nothing.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:render`
Expected: PASS — all three render tests, including the two that existed before.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/duck-proof-video.json test/render/duck.render.test.ts
git commit -m "test: prove a duck by measuring the bed under and clear of narration"
```

---

## Self-Review Notes

**Spec coverage.** §2 (the timeline cannot express ducking) → Task 2, including the parallel lane, the clamp, the reporting of *any* clamp rather than only the degenerate one, and both `timing.at(-1)` call sites. §3 (mechanism, authored level) → Task 1 for `duckTo` and the two cross-field validations, Task 3 for the envelope with the ramp as a code constant. §3's envelope requirements — contiguous spans, crossing ramps, bed edges — are one test each in Task 3. §4, §5 and §6's compile-step and captions risks are Phases 2 and 3, out of scope here. §6's "a duck is hard to prove" → Task 5, which measures a sliced window rather than the whole file. §6's note that §3's `superRefine` will share a hook with issue #13 is a design-time observation; Task 1 adds the first one and leaves it extensible.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. All envelope expectations in Task 3 were produced by running the Step 3 implementation.

**Type consistency.** `buildDuckEnvelope(bedSpan, duckSpans, duckTo)` is defined in Task 3 and called with that exact shape in Task 4. `Span` is `{ startSeconds, endSeconds }` in both. `AudioSequenceSpec` gains `beatId` and `volume` in Task 4 and is consumed in the same task's JSX. `BedClamp` is `{ beatId, requestedSeconds, actualSeconds }` in Task 2's definition, test, and pipeline call site. `duckTo` is `number` in `(0,1]` everywhere.

**Ordering.** Tasks 1 and 3 are independent of everything and of each other. Task 2 is independent but changes semantics several existing tests encode, so its test updates are part of it. Task 4 needs 1, 2 and 3. Task 5 needs all of them plus Chrome and ffmpeg. Only Task 5 requires anything beyond `npm test`, and nothing in this plan requires a TTS service.
