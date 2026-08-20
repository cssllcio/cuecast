# Pronunciation fixture-test procedure

Run before any product's first real render, and again whenever the TTS
engine or voice profile changes — respellings are engine-specific and do
not transfer between engines (spec §5).

1. `CUECAST_TTS_URL=http://127.0.0.1:<port> CUECAST_TTS_PROFILE_ID=<profile> npx tsx scripts/fixture-test.ts`
2. Listen to every file listed in `generated/fixture-test/manifest.json`.
3. For each term that sounds wrong, update the respelling in `lexicon/base.json`
   (or the consuming product's own override file, if the term is
   product-specific) and re-run step 1 for that term only.
4. Record the winning spellings by committing the updated lexicon file(s).
   `generated/` itself is gitignored — the audio review files are scratch,
   the lexicon file is the durable output.
