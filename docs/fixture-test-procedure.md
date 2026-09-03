# Pronunciation fixture-test procedure

Run before any product's first real render, and again whenever the TTS
engine or voice profile changes — respellings are engine-specific and do
not transfer between engines (spec §5).

1. `CUECAST_TTS_URL=http://127.0.0.1:<port> CUECAST_TTS_PROFILE_ID=<profile> npx tsx scripts/fixture-test.ts`
2. Listen to every file listed in `generated/fixture-test/manifest.json`. Each
   term appears three times, once per seed. Judge the term, not the take: a
   respelling is right if it reads correctly on all three.

   Why three seeds, and why fixed: generation is deterministic given a seed, so
   repeating one seed produces byte-identical audio and proves nothing. Different
   seeds produce genuinely different takes — the same sentence has measured 1.52s
   on one seed and 4.22s on another — and a single take can be pathological. One
   *unseeded* take of `sett` came back at 6.64 seconds for one word on 2026-09-02,
   which would have condemned a good respelling had anyone judged it on that alone.
   (Raw measurements: `docs/superpowers/specs/2026-09-02-cuecast-narration-seed-design.md`
   §1 for the unseeded `sett` takes, §2 for the seeded md5/duration/byte-count
   table. A fixture-test run's own takes are all seeded, so they won't reproduce
   that unseeded outlier — that's seeding working, not a contradiction.)
   Fixed seeds mean two people running this procedure hear the same audio.
3. For each term that sounds wrong, update the respelling in `lexicon/base.json`
   (or the consuming product's own override file, if the term is
   product-specific) and re-run step 1 for that term only.
4. Record the winning spellings by committing the updated lexicon file(s).
   `generated/` itself is gitignored — the audio review files are scratch,
   the lexicon file is the durable output.
