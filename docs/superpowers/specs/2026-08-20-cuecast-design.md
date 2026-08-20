# cuecast — narration-timed reveal animations, design

**Status:** design, awaiting maintainer review · **Date:** 2026-08-20
**Origin:** generalized from a Vibrai feature request
(`docs/feature-requests/vibrai-demo-video-pipeline.md` in `gitizenme/Vibrai`).
Vibrai is the first consuming product, not the owner — this repo has no
Vibrai dependency and carries no Vibrai-specific decisions.

---

## 1 · What this is

A declarative pipeline that turns a script plus an existing diagram into a
narrated explainer video, sized for 45–90s demo/explainer clips plus static
diagram exports. One JSON file per video is the only thing a human edits by
hand; everything else — SVG, audio, timing, the rendered clip — is a build
artifact.

**The core mechanism (the timing inversion):** conventional order is animate,
then cut narration to fit, which makes every script edit expensive. cuecast
generates narration first, transcribes it back to get real timestamps, and
writes those timestamps into the script file. The renderer reads timing via
expressions rather than hand-placed keyframes, so reveals land on the
narration automatically and a script edit re-syncs on rebuild.

## 2 · Decision taken here: diagrams are Mermaid, not a bespoke schema

The originating brief proposed a `nodes`/`edges` JSON schema, its own
generator script, and an Illustrator/After Effects render chain. This design
replaces that leg entirely:

- **The diagram is a Mermaid C4 block already living in the product's own
  docs** (or a standalone `.mmd` file), not a second, cuecast-owned diagram
  format. Editing the diagram means editing the doc; a video can never drift
  from the documentation it illustrates the way a hand-maintained duplicate
  would.
- **Render is code-native.** The Mermaid source renders to SVG once via
  `mmdc` (headless Chrome), and a programmatic compositor (Remotion) imports
  that SVG and animates it from code, reading timing out of the generated
  `timing` block via expressions. No Illustrator import, no After Effects
  re-import step — both risks the original brief flagged (SVG-import
  fidelity, AE not picking up new layers on re-import) are structurally
  absent because there is no round trip through either tool.

This trades some of Mermaid's auto-layout control for a single, undivided
source of truth. See §6 for the risk that trade carries and the spike that
resolves it before implementation locks in.

## 3 · `video.json` schema

```json
{
  "id": "video_id",
  "diagram": {
    "source": "path/to/doc.md#anchor-of-mermaid-block",
    "revealGroups": {
      "group_a": ["nodeId1", "relId1"],
      "group_b": ["nodeId2"]
    }
  },
  "script": [
    { "id": "beat_01", "type": "narration",
      "text": "Vibrai writes the arrangement directly into Ableton Live.",
      "spoken": "vih-BRY writes the ar-PEJ-ee-ay-ter directly into Ableton Lyve.",
      "reveal": ["group_a"] },
    { "id": "beat_02", "type": "silence", "duration": 2.0 },
    { "id": "beat_03", "type": "bed", "audio": "captured-clip.wav",
      "duck": ["beat_04"] }
  ],
  "pronunciations": { "vibrai": "vih-BRY" },
  "timing": {}
}
```

- `text` is what appears in captions and docs; `spoken` is what goes to the
  TTS API. This split exists because respelling breaks the transcribe round
  trip (see §5) — Whisper transcribes the sound it was given back, and
  `vih-BRY` will not match `text` word-for-word. Timing extraction aligns on
  segment boundaries, not word-matching against `text`.
- `script` entries are typed (`narration` | `silence` | `bed`), not implicitly
  narration-only. Silence is a first-class beat with an explicit duration,
  not an incidental gap — a script that only ever narrates cannot represent
  "let the diagram sit for two seconds," and a product whose payoff is
  something other than narration (a captured screen recording, a rendered
  audio bed) needs a beat type that means "play this audio under/instead of
  narration." `duck` on a `bed` beat names which narration beats need
  sidechain-style level reduction against it — mechanism only; whether a
  given product needs ducking at all is a per-product concern, not asserted
  here.
- `timing` is always generated, never hand-authored, and is the only field a
  rebuild is allowed to overwrite wholesale.
- `revealGroups` maps a name to a set of Mermaid element IDs; a narration
  beat's `reveal` list names which groups become visible when that beat
  starts. This is the addressing scheme §6's spike has to confirm is even
  possible against Mermaid's rendered SVG.

## 4 · Pipeline stages

| Stage | Tool | Automation |
|---|---|---|
| Diagram → SVG | `mmdc` (Mermaid CLI, headless Chrome) | full |
| Narration | local TTS service `POST /generate` | full |
| Timing extraction | local TTS service `POST /transcribe` (Whisper) | full |
| Compose + animate | Remotion, reading `video.json` as data | full |
| Render | `npx remotion render` | full |
| Encode | ffmpeg (Remotion's own pipeline) | full |

Every stage is scriptable and headless — no manual step remains in the core
pipeline. (A product whose hero shot is a screen recording supplies that
recording as a `bed` beat's audio/video asset; capturing it is that product's
own concern, out of scope for cuecast itself.)

## 5 · Narration service integration

- Local REST API, cloned voice profile referenced by `profile_id` — both
  supplied by the consuming product's config, not hardcoded here.
- Effects (compression, HPF) applied via the TTS service's own per-profile
  chain rather than a separate audio-editing round trip.
- **Engine switching within one video will produce audible timbre shifts**
  even from the same cloned profile — pick one engine per video. This is a
  hard constraint on the schema: `video.json` does not carry a per-beat
  engine override.
- **Synthetic-voice disclosure is a per-product policy decision**, not one
  this design makes on a product's behalf — a product's own brand voice may
  require different treatment than another's. cuecast's job is to make the
  generated/synthetic nature of a clip inspectable (the `spoken` field, the
  `profile_id`, and the render manifest all say plainly what produced the
  audio); whether and how a product discloses that to viewers is configured
  per product, not decided in this repo.

### Pronunciation handling

Non-negotiable, built into v1 — retrofitting after a back catalogue exists
across multiple products is worse than doing it once. These engines are
end-to-end neural: no SSML phoneme tag, no lexicon file to load. The only
lever is orthographic respelling — write the term the way an English reader
would sound it out. No IPA; it reads as literal characters.

Failure classes, carried from the originating brief because they are
properties of the TTS engines, not of Vibrai specifically:

1. **Homographs** — produce a real word, confidently wrong (worst class:
   nothing *sounds* broken).
2. **Coined names** — no correct answer the model can guess. Every product's
   own name is the highest-value lexicon entry, appearing in every video for
   that product.
3. **Acronyms** — force the spell-it-out vs. say-it-as-a-word choice
   explicitly; don't let the model guess.
4. **Stress placement** — hyphens separate syllables, caps mark stress.

**Lexicon structure:** a small shared base lexicon for terms that recur
across products (`API`, `CLI`, `MCP`) plus a per-product override file for
product-specific coined names and domain terms. The base lexicon lives in
this repo; product overrides live in the product's own repo and are supplied
to cuecast as config — cuecast itself carries no product's terminology.

**Fixture test, mandatory before any product's first real render:** write
the at-risk terms into a test file, generate once against the real profile,
listen, record the winning spelling. Re-run whenever the engine or profile
changes — respellings are engine-specific and do not transfer between TTS
engines.

## 6 · Risks

- **Mermaid element addressability (new risk this design introduces, highest
  priority to resolve).** Approach A depends on `revealGroups` naming stable,
  selectable IDs on Mermaid's rendered SVG output. This has not been verified
  against a real C4 diagram. **Spike before any further build:** render one
  real `C4Container` diagram via `mmdc`, inspect the output SVG's DOM for
  per-node and per-`Rel` identifiers, confirm they're stable across
  re-renders of the same source. If Mermaid's C4 output only exposes group-
  level wrappers (not individual elements), `revealGroups` needs to key on
  those wrappers instead — workable, but changes what "reveal" can
  granularly target, and should be known before the schema is locked.
- **Auto-layout vs. video composition.** A diagram built for reading on a
  docs page (dense, small type) may need recomposition for video (larger
  type, fewer simultaneous elements) — Mermaid's layout engine doesn't know
  it's being read on a phone. Expect some diagrams to need a video-specific
  variant rather than reusing the docs rendering verbatim; this is real
  authoring work, not a defect in the approach.
- **Whisper timestamp granularity — open, unresolved, carried from the
  originating brief.** Segment-level timestamps are workable (reveals snap to
  phrase boundaries); word-level would allow tighter emphasis sync. Verify
  against a real `/transcribe` response before the timing-extraction stage is
  considered done — this gates the whole timing inversion, independent of
  which render approach is used.
- **Cross-product lexicon collisions.** A term correct for one product's
  pronunciation might be wrong for another's brand voice (a shared acronym
  read differently by two products). Low risk in practice since each
  product's overrides are scoped to that product's own file, but worth a
  lint step that warns (not blocks) when a base-lexicon term is overridden
  identically in every product, since that usually means it belongs in the
  base lexicon instead of being duplicated.

## 7 · Build order

1. **Mermaid-addressability spike** (§6) — the one unknown that determines
   whether `revealGroups` as specified is buildable at all. Do this first;
   everything else assumes its answer.
2. `video.json` schema (this doc, §3) + narration service `/generate` +
   `/transcribe` round trip; verify Whisper timestamp granularity; run the
   pronunciation fixture test against a real profile to lock the base
   lexicon. Independent of step 1 — can run in parallel.
3. Remotion composition consuming one real Mermaid SVG + a hand-written
   `timing` block (not yet generated) — proves the render leg in isolation.
4. Wire steps 2 and 3 together: generated timing drives the Remotion
   composition end-to-end for one real video.
5. `silence` and `bed` beat types, ducking as a Remotion-side primitive
   (mechanism only — no product-specific ducking preset lives here).
6. CLI wrapper (`cuecast build video.json --out out.mp4`) and a caption
   export (`text` fields, using generated `timing`).
7. Pilot integration into the first consuming product's own repo.

Steps 1 and 2 are both first-priority and independent — do them before
anything else, same as the originating brief's own build-order rationale.

## 8 · Explicitly out of scope for this repo

- Any product's actual `video.json` content, scripts, or diagrams.
- Any product's pronunciation-lexicon overrides.
- Screen/window capture of a running application — a GUI product's own
  concern, entering this pipeline only as a `bed` beat's audio/video asset.
- Publishing/distribution of finished videos.
- Any decision specific to how Vibrai (or any other product) records,
  narrates, or ships its own videos — those live in that product's own repo.
