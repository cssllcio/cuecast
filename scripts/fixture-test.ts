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

const client = new NarrationClient({ baseUrl, profileId });
const results: Array<{ term: string; respelling: string; audioPath: string }> = [];

for (const [term, respelling] of Object.entries(baseLexicon)) {
  const { audioPath } = await client.generate(respelling);
  results.push({ term, respelling, audioPath });
  console.log(`generated: ${term} -> "${respelling}" -> ${audioPath}`);
}

writeFileSync(
  `${outputDir}/manifest.json`,
  JSON.stringify(results, null, 2)
);
console.log(`\nListen to each file in ${outputDir}, then follow docs/fixture-test-procedure.md.`);
