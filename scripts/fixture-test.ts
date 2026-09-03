import { mkdirSync, writeFileSync } from "node:fs";
import { NarrationClient } from "../src/narration/narrationClient.js";
import baseLexicon from "../lexicon/base.json" with { type: "json" };

const baseUrl = process.env.CUECAST_TTS_URL;
const profileId = process.env.CUECAST_TTS_PROFILE_ID;

if (!baseUrl || !profileId) {
  console.error(
    "Set CUECAST_TTS_URL and CUECAST_TTS_PROFILE_ID before running the fixture test."
  );
  process.exit(1);
}

const outputDir = "generated/fixture-test";
mkdirSync(outputDir, { recursive: true });

// Generated WAVs land in outputDir itself, which is exactly where the
// procedure tells the listener to look.
//
// Three fixed seeds per term, not one take and not one seed repeated.
// Repeating a seed is byte-identical by construction and proves nothing; a
// single unseeded take is what produced a 6.64s hallucination for "sett" on
// 2026-09-02, which would have wrongly condemned a good respelling. Three
// different seeds sample what real beats will actually draw, and being fixed
// means two people running this hear the same audio and can argue about the
// same evidence.
const SEEDS = [4000, 4001, 4002];

const client = new NarrationClient({ baseUrl, profileId, audioOutputDir: outputDir });
const results: Array<{
  term: string;
  respelling: string;
  seed: number;
  audioPath: string;
}> = [];

for (const [term, respelling] of Object.entries(baseLexicon)) {
  for (const seed of SEEDS) {
    const { audioPath } = await client.generate(respelling, seed);
    results.push({ term, respelling, seed, audioPath });
    console.log(`generated: ${term} -> "${respelling}" @seed ${seed} -> ${audioPath}`);
  }
}

writeFileSync(
  `${outputDir}/manifest.json`,
  JSON.stringify(results, null, 2)
);
console.log(`\nListen to each file in ${outputDir}, then follow docs/fixture-test-procedure.md.`);
