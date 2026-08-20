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
});
