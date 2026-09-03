import { describe, expect, it } from "vitest";
import { parseVideoScript } from "./videoScript.js";

const validScript = {
  id: "example_video",
  diagram: {
    source: "test/fixtures/generic-container.mmd",
    revealGroups: { group_api: ["api"], group_db: ["db"] },
  },
  script: [
    {
      id: "beat_01",
      type: "narration",
      text: "The API talks to the database.",
      spoken: "The A P I talks to the database.",
      reveal: ["group_api"],
    },
    { id: "beat_02", type: "silence", duration: 1.5 },
  ],
  pronunciations: { api: "A P I" },
  timing: [],
};

describe("parseVideoScript", () => {
  it("accepts a valid video script", () => {
    const parsed = parseVideoScript(validScript);
    expect(parsed.id).toBe("example_video");
    expect(parsed.script).toHaveLength(2);
  });

  it("rejects a narration beat missing the spoken field", () => {
    const invalid = {
      ...validScript,
      script: [
        { id: "beat_01", type: "narration", text: "no spoken field" },
      ],
    };
    expect(() => parseVideoScript(invalid)).toThrow();
  });

  it("rejects an unknown beat type", () => {
    const invalid = {
      ...validScript,
      script: [{ id: "beat_01", type: "explosion" }],
    };
    expect(() => parseVideoScript(invalid)).toThrow();
  });

  it("accepts a timing entry with an audioPath and preserves it", () => {
    const withAudio = {
      ...validScript,
      timing: [
        { beatId: "beat_01", startSeconds: 0, endSeconds: 2.4, audioPath: "audio/beat_01.wav" },
      ],
    };
    const parsed = parseVideoScript(withAudio);
    expect(parsed.timing[0].audioPath).toBe("audio/beat_01.wav");
  });

  it("accepts a timing entry with no audioPath", () => {
    const withoutAudio = {
      ...validScript,
      timing: [{ beatId: "beat_01", startSeconds: 0, endSeconds: 2.4 }],
    };
    const parsed = parseVideoScript(withoutAudio);
    expect(parsed.timing[0].audioPath).toBeUndefined();
  });
});

describe("seed", () => {
  it("accepts a narration beat with an explicit seed", () => {
    const parsed = parseVideoScript({
      ...validScript,
      script: [{ ...validScript.script[0], seed: 4000 }],
    });
    expect(parsed.script[0]).toMatchObject({ seed: 4000 });
  });

  it("accepts a narration beat with no seed", () => {
    const parsed = parseVideoScript(validScript);
    expect(parsed.script[0]).not.toHaveProperty("seed");
  });

  it("accepts zero", () => {
    expect(() =>
      parseVideoScript({
        ...validScript,
        script: [{ ...validScript.script[0], seed: 0 }],
      })
    ).not.toThrow();
  });

  // Voicebox answers a negative seed with HTTP 422, so rejecting it at parse
  // time turns a wasted round trip into an immediate, local error.
  it("rejects a negative seed", () => {
    expect(() =>
      parseVideoScript({
        ...validScript,
        script: [{ ...validScript.script[0], seed: -1 }],
      })
    ).toThrow();
  });

  it("rejects a fractional seed", () => {
    expect(() =>
      parseVideoScript({
        ...validScript,
        script: [{ ...validScript.script[0], seed: 1.5 }],
      })
    ).toThrow();
  });

  // beatSeed's derivation never exceeds 2^31 - 1 (the range verified safe
  // for Voicebox); an authored seed outside that range should fail locally
  // at parse time rather than round-tripping to the service as a 422.
  it("rejects an authored seed above 2^31 - 1", () => {
    expect(() =>
      parseVideoScript({
        ...validScript,
        script: [{ ...validScript.script[0], seed: 1e21 }],
      })
    ).toThrow();
  });

  it("accepts an authored seed at exactly the upper bound", () => {
    expect(() =>
      parseVideoScript({
        ...validScript,
        script: [{ ...validScript.script[0], seed: 2 ** 31 - 1 }],
      })
    ).not.toThrow();
  });

  it("records a seed on a timing entry", () => {
    const parsed = parseVideoScript({
      ...validScript,
      timing: [
        { beatId: "beat_01", startSeconds: 0, endSeconds: 2.4, seed: 4000 },
      ],
    });
    expect(parsed.timing[0]).toMatchObject({ seed: 4000 });
  });
});

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
