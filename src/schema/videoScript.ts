import { z } from "zod";

// What a hand-authored id may look like — for the video and for every beat.
//
// This is the authoritative rule, and it is deliberately stricter than
// `assertPathSafeId` in src/audio/publicAudioPath.ts. The two answer different
// questions: this one decides what an author is allowed to write, and can
// tighten over time; that one guarantees a path already being formed cannot
// escape, and protects a caller who bypassed this schema entirely. Everything
// legal here is legal there, so they cannot disagree.
//
// Ids end up as filenames (audio/<videoId>/<beatId>.wav) and as hash keys
// (src/narration/beatSeed.ts), so restricting them to a portable alphabet
// removes a class of surprises rather than enumerating exclusions.
const idSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "must contain only letters, digits, underscores and hyphens"
  );

const narrationBeatSchema = z.object({
  id: idSchema,
  type: z.literal("narration"),
  text: z.string(),
  spoken: z.string(),
  reveal: z.array(z.string()).optional(),
  // Authored escape hatch from a bad take. Absent means derived from the
  // beat's identity — see src/narration/beatSeed.ts. Upper-bounded to the
  // same range beatSeed's derivation stays inside (< 2^31, the range known
  // safe for Voicebox) so an out-of-range authored value — e.g. "seed": 1e21
  // — fails locally at parse time instead of round-tripping to the service
  // as a 422.
  seed: z.number().int().nonnegative().max(2 ** 31 - 1).optional(),
});

const silenceBeatSchema = z.object({
  id: idSchema,
  type: z.literal("silence"),
  duration: z.number().positive(),
});

const bedBeatSchema = z.object({
  id: idSchema,
  type: z.literal("bed"),
  audio: z.string(),
  duck: z.array(z.string()).optional(),
  // Linear gain, matching Remotion's <Audio volume> domain rather than dB.
  // Required whenever `duck` is non-empty — see the superRefine below. There
  // is deliberately no default: the spec forbids a product-specific ducking
  // preset living in this repo, and a default gain is exactly that.
  duckTo: z.number().gt(0).lte(1).optional(),
});

const scriptBeatSchema = z.discriminatedUnion("type", [
  narrationBeatSchema,
  silenceBeatSchema,
  bedBeatSchema,
]);

const timingEntrySchema = z.object({
  beatId: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  audioPath: z.string().optional(),
  // Generated, never authored: the seed this beat's audio was actually made
  // with, so a past render is explicable without re-deriving anything.
  // Narration-only, like audioPath — silence and bed beats never reach the TTS.
  seed: z.number().int().nonnegative().optional(),
});

const videoScriptSchema = z
  .object({
    id: idSchema,
    diagram: z.object({
      source: z.string(),
      revealGroups: z.record(z.array(z.string())),
    }),
    script: z.array(scriptBeatSchema),
    pronunciations: z.record(z.string()),
    timing: z.array(timingEntrySchema),
  })
  .superRefine((script, ctx) => {
    // Beat ids must be unique across the WHOLE script, regardless of type.
    // The pipeline keys three maps on them — durations, audioPaths and seeds —
    // without regard for a beat's type, so a duplicate silently means last
    // writer wins: two timing entries pointing at one audio file, one beat's
    // probed duration overwriting another's, and a narration seed landing on a
    // bed beat's timing entry, which design §4 says must never carry one.
    const seenBeatIds = new Set<string>();
    script.script.forEach((beat, index) => {
      if (seenBeatIds.has(beat.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["script", index, "id"],
          message: `duplicate beat id "${beat.id}"; beat ids must be unique across the whole script`,
        });
      }
      seenBeatIds.add(beat.id);
    });

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

export type BeatType = "narration" | "silence" | "bed";
export type NarrationBeat = z.infer<typeof narrationBeatSchema>;
export type SilenceBeat = z.infer<typeof silenceBeatSchema>;
export type BedBeat = z.infer<typeof bedBeatSchema>;
export type ScriptBeat = z.infer<typeof scriptBeatSchema>;
export type TimingEntry = z.infer<typeof timingEntrySchema>;
export type VideoScript = z.infer<typeof videoScriptSchema>;

export function parseVideoScript(json: unknown): VideoScript {
  return videoScriptSchema.parse(json);
}
