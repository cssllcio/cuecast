import type { NarrationBeat } from "../schema/videoScript.js";
import { applyLexicon, type Lexicon } from "./lexicon.js";

/**
 * What a narration beat actually sends to the TTS.
 *
 * Every beat's `spoken` goes through the lexicon, unconditionally. This used to
 * read `beat.spoken || applyLexicon(beat.text, lexicon)` inside the render
 * script, which looked like a fallback but was dead code: `spoken` is a
 * required string in the schema, so the respelling only ran for the empty
 * string and narration reached the TTS exactly as hand-typed.
 *
 * Applying it uniformly rather than relying on hand-respelling is the lesson
 * from Vibrai's shorts pipeline, where per-file hand-respelling demonstrably
 * did not hold — episodes respelled `Vibrai` but still left `CLI` and `JSON`
 * raw, and a real take shipped saying "CLI" as a word. Respelling twice is
 * harmless: whole-word matching plus respellings that contain no instance of
 * their own term make this idempotent by construction.
 *
 * `text` is never touched. It is what a viewer reads, and a respelling reaching
 * a caption is the exact failure the text/spoken split exists to prevent.
 */
export function spokenForBeat(beat: NarrationBeat, lexicon: Lexicon): string {
  return applyLexicon(beat.spoken, lexicon);
}
