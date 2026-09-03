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

  // `set` is the one base-lexicon entry that is an ordinary English word rather
  // than an acronym, so the whole-word guarantee is doing real work: chatterbox
  // reads the plain word as "sit" (caught by ear on Vibrai's S04), but "settle"
  // and "asset" must survive untouched.
  //
  // Note the replacement is not case-preserving: a sentence-initial "Set"
  // becomes "sett". That is deliberate — the respelling is authoritative for
  // casing, which is the only reason `api` -> `A P I` and `mcp` -> `em see pee`
  // can encode the casing they want. The result is only ever heard by the TTS,
  // never read by a viewer, so the lost capital costs nothing.
  it("respells the word set without touching words that contain it", () => {
    const lexicon = { set: "sett" };
    expect(applyLexicon("Set the tempo.", lexicon)).toBe("sett the tempo.");
    expect(applyLexicon("Settle the asset.", lexicon)).toBe(
      "Settle the asset."
    );
  });

  it("is idempotent across the whole base lexicon", () => {
    const lexicon = {
      api: "A P I",
      cli: "C L I",
      mcp: "em see pee",
      json: "jay son",
      url: "U R L",
      set: "sett",
    };
    const text = "Set the API, the CLI, the MCP server, JSON and the URL.";

    const once = applyLexicon(text, lexicon);
    expect(applyLexicon(once, lexicon)).toBe(once);
  });
});
