import { z } from "zod";

const narrationBeatSchema = z.object({
  id: z.string(),
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
  id: z.string(),
  type: z.literal("silence"),
  duration: z.number().positive(),
});

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
