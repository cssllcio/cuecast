import { z } from "zod";

const narrationBeatSchema = z.object({
  id: z.string(),
  type: z.literal("narration"),
  text: z.string(),
  spoken: z.string(),
  reveal: z.array(z.string()).optional(),
  // Authored escape hatch from a bad take. Absent means derived from the
  // beat's identity — see src/narration/beatSeed.ts.
  seed: z.number().int().nonnegative().optional(),
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

const videoScriptSchema = z.object({
  id: z.string(),
  diagram: z.object({
    source: z.string(),
    revealGroups: z.record(z.array(z.string())),
  }),
  script: z.array(scriptBeatSchema),
  pronunciations: z.record(z.string()),
  timing: z.array(timingEntrySchema),
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
