# cuecast — reproducible narration, design

**Status:** design, awaiting maintainer review · **Date:** 2026-09-02
**Issue:** cssllcio/cuecast#11
**Relates to:** `docs/superpowers/specs/2026-08-20-cuecast-design.md` §1 (the
timing inversion), §5 (narration service integration). Lands before the
ducking/CLI/captions work, which rebases on it.

---

## 1 · The problem

cuecast's central claim is that narration timing is data: generate the audio,
take its real duration, write that into `timing`, and the reveals follow. That
holds only if the same script produces the same durations. It does not.

`NarrationClient` posts `{ text, profile_id, engine }` and no seed, so every
generation is a fresh roll. Measured against a local Voicebox, engine
`chatterbox`, same text each time:

| text | durations across takes | spread |
|---|---|---|
| `Set the tempo to one twenty.` | 5.08s, 1.50s, 1.64s, 4.16s | 3.4x |
| `sett the tempo to one twenty.` | 1.48s, 1.38s, 3.08s, 2.84s | 2.2x |
| `sett` (bare word) | 6.64s, 1.12s, 1.22s, 1.28s, 1.16s | 5.9x |

So re-rendering an unchanged `video.json` moves every reveal. The README's "edit
the script, rebuild, reveals re-sync" is true; what it does not say is that a
rebuild with no edit also re-syncs, to something else.

The 6.64s take is worth naming separately: `volumedetect` shows real speech
throughout (mean -20.0 dB, max -1.4 dB) with three short internal gaps, so the
engine produced ~6.6s of *something* for one word. Bad takes are reachable, and
without a seed they can neither be reproduced for diagnosis nor avoided.

## 2 · Seeding works — verified, not assumed

The whole design rests on one empirical question, so it was answered before
anything was designed. Same text, engine `chatterbox`, profile
`Wide Range Voice Sample`:

| | md5 | duration | bytes |
|---|---|---|---|
| seed 4000, take 1 | `1a80bb5f…` | 1.52s | 73004 |
| seed 4000, take 2 | `1a80bb5f…` | 1.52s | 73004 |
| seed 4000, take 3 | `1a80bb5f…` | 1.52s | 73004 |
| seed 4001 | `efe443dd…` | 4.22s | 202604 |

Same seed gives byte-identical audio, three for three. The service also echoes
the seed on both `POST /generate` and `GET /history/{id}`, and rejects a negative
one with HTTP 422 — its `GenerationRequest` schema declares
`seed: integer >= 0 | null`.

Note the second row of consequence: 1.52s versus 4.22s for *identical text*,
differing only by seed. The variance in §1 was seed randomness all along, and a
bad seed is an ordinary state an author will land in.

## 3 · Where a seed comes from

**Decision: derived from the beat's identity, overridable per beat.**

`seed` becomes an optional `integer >= 0` on a narration beat. When absent it is
`beatSeed(videoId, beatId)` — a stable hash. An unchanged script therefore
reproduces exactly, with nothing to author; escaping a bad take means writing one
explicit number on one beat.

The video id is part of the key so the same `beat_01` in two different videos
does not draw the same audio. That is the same reasoning that made
`publicAudioPath` namespace by video id in PR #8.

**Rejected: Vibrai's `SEED_BASE + index`.** `vo.sh` seeds from a video-level base
plus the line's ordinal, and for that pipeline it is fine. Here it is not:
inserting one beat re-rolls every beat after it — new audio, new durations, new
timing for the remainder of the video. In a pipeline whose output *is* the
timing, that makes a one-line insertion maximally expensive. Keying on identity
rather than position costs nothing and avoids it entirely.

**The hash must never change.** `beatSeed` is hand-rolled FNV-1a (32-bit, masked
to 31 bits) rather than taken from a dependency or from anything environment-
provided, because its output has to be stable across Node versions and platforms
forever. Changing it silently invalidates the reproducibility of every render
ever made — the artifact still renders, it just renders differently, and nothing
announces it. Golden input/output pairs are pinned in a test so a change cannot
pass unnoticed.

## 4 · Recording what was used

**Decision: the resolved seed is written into the generated `timing` entries,**
alongside `audioPath`.

The seed is re-derivable, so this is redundant — until the day it is not. A
render made before any change to derivation, or one where a beat carried an
explicit override that has since been edited, is only explicable if the artifact
says what it actually used. Recording it makes a past render self-describing:
what produced this MP4 is answerable from the generated output, without
re-deriving anything.

The field is optional and present only on narration entries. `silence` and `bed`
beats get timing entries too, and neither goes through the TTS, so a seed on
those would be meaningless — the same way `audioPath` is absent on a `silence`
entry today.

This does not touch the authored file. `timing` remains generated, never hand-
authored, and the only field a rebuild overwrites wholesale (original spec §3).

## 5 · Making omission impossible

`NarrationClient.generate(spokenText, seed)` takes the seed as a **required**
parameter. Not optional with a default — required, so no caller can quietly fail
to pass one.

This is a direct response to a bug fixed the same day. The pronunciation lexicon
was dead code for months because `beat.spoken || applyLexicon(beat.text, …)`
looked like a fallback but could never fire. Nothing failed; the feature simply
did not happen. A seed that defaults silently is the identical shape, and the
consequence is worse, because unseeded output looks perfectly fine in isolation.

The client also asserts that the completed generation echoes the seed it sent,
and throws when it does not. If the service ever ignored the field, every render
would look correct while reproducibility was quietly gone — the same failure
shape as issue #1, where the file existed and the audio did not. The repo's rule
is to measure the thing itself; here the thing is that the seed took effect.

## 6 · The fixture test changes method, not just settings

Determinism changes how a respelling is judged by ear.

Today `fixture-test.ts` generates one take of a bare word per lexicon entry. Both
properties are now known to mislead: a single unseeded take produced the 6.64s
hallucination for `sett`, and a maintainer hearing only that would have rejected
a good respelling. Repeating a *seeded* take fixes nothing either — it is
byte-identical by construction.

What the test needs is **three different fixed seeds** per term, because the
respelling has to hold across whatever seeds real beats draw. Three is chosen so
a single pathological roll cannot decide the question while the listening stays
short — six entries at three seeds is eighteen clips, which is a few minutes of
generation and a minute of listening. The seeds are constants in the script, not
random per run, so two people running the procedure hear the same audio and can
argue about the same evidence.

The procedure doc says why, since the reasoning is not obvious from the code.

## 7 · Risks

- **A one-time shift in every render.** Derived seeds replace unseeded rolls, so
  the next render of any existing script differs from the last. Expected, not a
  regression — but it lands on the pilot's content too, and is worth doing before
  a product depends on specific timings.
- **The hash is a compatibility surface.** §3 treats it as immutable; it needs to
  be understood that way by anyone tempted to "improve" it.
- **Reproducibility is per-engine and per-profile.** A seed fixes the sampling,
  not the model. Changing engine or voice profile changes the audio at the same
  seed, exactly as respellings do not transfer between engines (original spec §5).
- **Determinism is not quality.** A pinned seed makes a bad take permanent rather
  than intermittent. That is the intended trade — a reproducible bad take can be
  heard, diagnosed, and overridden, where an intermittent one cannot.

## 8 · Explicitly out of scope

- Choosing good seeds automatically, or scoring takes for quality. An author
  hears a bad take and writes a different number.
- Caching or reusing generated audio across renders. Reproducibility makes that
  possible later; it is not this change.
- Any product's seed values or overrides — those live in the product's own repo,
  like its scripts and lexicon overrides.
- Seeding anything but narration. `bed` beats are supplied assets and `silence`
  is authored duration; neither goes through the TTS.
