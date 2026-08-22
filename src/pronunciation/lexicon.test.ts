import { describe, expect, it } from "vitest";
import { applyLexicon, mergeLexicons } from "./lexicon.js";

describe("mergeLexicons", () => {
  it("lets a product override entries take precedence over the base lexicon", () => {
    const base = { api: "A P I", cli: "C L I" };
    const override = { api: "ay pee eye" };

    expect(mergeLexicons(base, override)).toEqual({
      api: "ay pee eye",
      cli: "C L I",
    });
  });
});

describe("applyLexicon", () => {
  it("replaces whole-word matches case-insensitively", () => {
    const lexicon = { api: "A P I" };
    expect(applyLexicon("The API is fast.", lexicon)).toBe(
      "The A P I is fast."
    );
  });

  it("does not replace inside a longer word", () => {
    const lexicon = { cap: "kap" };
    expect(applyLexicon("Capital city.", lexicon)).toBe("Capital city.");
  });
});
