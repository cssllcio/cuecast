import { describe, expect, it } from "vitest";
import type { NarrationBeat } from "../schema/videoScript.js";
import { spokenForBeat } from "./spokenForBeat.js";

const LEXICON = { api: "A P I", cli: "C L I", set: "sett" };

function beat(overrides: Partial<NarrationBeat> = {}): NarrationBeat {
  return {
    id: "beat_01",
    type: "narration",
    text: "The API is fast.",
    spoken: "The API is fast.",
    ...overrides,
  };
}

describe("spokenForBeat", () => {
  // The bug this function exists to prevent: renderVideo used to send
  // `beat.spoken || applyLexicon(beat.text, lexicon)`, and because `spoken` is
  // a required non-empty string the respelling never ran. Narration reached the
  // TTS exactly as hand-typed.
  it("respells the beat's spoken text", () => {
    expect(spokenForBeat(beat(), LEXICON)).toBe("The A P I is fast.");
  });

  it("respells every beat, including one already hand-respelled", () => {
    const hand = beat({ spoken: "The A P I is fast." });
    expect(spokenForBeat(hand, LEXICON)).toBe("The A P I is fast.");
  });

  // Whole-word matching plus respellings that contain no instance of their own
  // term make this idempotent by construction, not by a special case. The
  // pipeline relies on it: a beat may be hand-respelled, respelled again here,
  // and re-rendered any number of times.
  it("is idempotent", () => {
    const once = spokenForBeat(beat(), LEXICON);
    const twice = spokenForBeat(beat({ spoken: once }), LEXICON);
    expect(twice).toBe(once);
  });

  // The whole point of the text/spoken split: a respelling reaching a viewer is
  // the failure the two fields exist to prevent, and captions read `text`.
  it("never respells the caption text", () => {
    const source = beat();
    spokenForBeat(source, LEXICON);
    expect(source.text).toBe("The API is fast.");
  });

  it("leaves a beat with nothing to respell unchanged", () => {
    const plain = beat({ spoken: "Nothing here needs respelling." });
    expect(spokenForBeat(plain, LEXICON)).toBe(
      "Nothing here needs respelling."
    );
  });
});
