# cuecast

Narration-timed reveal animations from a declarative script. You write a
`video.json` — narration beats and a pointer at a Mermaid C4 diagram already
living in your docs — and cuecast renders a video in which each diagram
element appears exactly when the narration introduces it.

**Status:** the foundations are built, reviewed, and verified end to end
against a real TTS service. One example video renders with generated
narration audio, reveals timed to it, and no manual steps. There is no CLI
yet; the entry point is `renderVideo()` in [`scripts/render-video.ts`](scripts/render-video.ts).
The issue tracker is empty.

## How it works

Conventional explainer-video order is: animate, then cut narration to fit,
so every script edit is expensive. cuecast inverts it. Narration is
generated first; each clip's real duration comes back from the TTS service;
those durations are written into the script's `timing` block; the renderer
reads them as data. Edit the script, rebuild, reveals re-sync.

| Stage | Tool |
|---|---|
| Diagram → SVG | `mmdc` (Mermaid CLI, headless Chrome) |
| Narration + timing | [Voicebox](https://voicebox.sh) `POST /generate` → poll `/history/{id}` → `export-audio`; the completed generation's `duration` is the beat's timing |
| Compose + animate | [Remotion](https://remotion.dev), reading `video.json` as props |
| Render + encode | Remotion → ffmpeg |

Three things are deliberate and worth knowing before you read the code:

- **The diagram is a Mermaid C4 block from your docs**, not a cuecast-owned
  format, so the video can't drift from the documentation it illustrates.
  Reveals key on Mermaid *node* aliases (`Person`, `Container`,
  `ContainerDb`); `Rel` edges and boundaries are not individually
  addressable in Mermaid's SVG output, so they stay visible throughout.
  Evidence: [`spikes/mermaid-addressability/`](spikes/mermaid-addressability/README.md).
- **There is no transcription step.** Voicebox's `/transcribe` returns no
  timestamps on any surface, and it mis-hears coined names badly enough to
  be useless as a pronunciation check. Timing is one span per beat, from
  `/generate`'s reported `duration` (verified exact against ffprobe).
  Evidence: [`spikes/narration-granularity/`](spikes/narration-granularity/README.md).
- **Pronunciation is orthographic respelling**, because these engines have
  no phoneme tags. Every beat carries both `text` (for captions) and
  `spoken` (what the TTS hears), and every `spoken` string is run through
  the lexicon on its way to the service — uniformly, not per beat by hand.
  Hand-respelling does not hold as a substitute: the pattern it produces is
  a script that respells its product name but still leaves `CLI` and `JSON`
  raw, and the mispronunciation is only caught by ear, after the render.
  `text` is never respelled, so captions keep reading "CLI" while the TTS
  hears the letters. A shared base lexicon of cross-product terms lives
  here; each consuming product keeps its own overrides in its `video.json`,
  and a human listens before a product's first real render — see
  [`docs/fixture-test-procedure.md`](docs/fixture-test-procedure.md).
  Changing an entry makes existing narration stale: `timing` comes from
  generated audio, so a re-render is what makes a new respelling take
  effect.

## Running it

```bash
npm install
npm test            # unit suite, no services needed
npm run test:render # renders a real MP4 from a checked-in fixture (needs Chrome)
```

The end-to-end path needs a running Voicebox and two environment variables:

```bash
CUECAST_TTS_URL=http://127.0.0.1:17493 \
CUECAST_TTS_PROFILE_ID=<voice profile id> \
npm run test:integration
```

That generates real narration for `test/fixtures/example-video.json`, lays
out timing, renders `out/example-video.mp4`, and asserts the output actually
carries audio signal — a file-exists check passed for weeks while narration
was being silently dropped, so the tests measure the thing itself.

`ffmpeg`/`ffprobe` must be on your `PATH` for the render and integration
tests. Pass `engine` explicitly to the client (default `chatterbox`); the
service's own default engine hung a server on first contact.

## Layout

```
src/schema/        video.json schema (narration | silence | bed beats; generated timing)
src/mermaid/       mmdc wrapper + SVG id inspection
src/narration/     Voicebox client: async generate, poll, fetch audio
src/timing/        sequential timeline from durations; frame conversions
src/pronunciation/ lexicon merge + respelling
src/audio/         public/ path namespacing, duration probing
src/remotion/      the Cuecast composition and its Root
scripts/           render-video.ts (the pipeline), fixture-test.ts (listen test)
lexicon/           shared base lexicon (cross-product terms only)
spikes/            the two investigations the design depended on
docs/              spec, plan, procedures
test/              fixtures, render proofs, live integration tests
```

## Scope

Product-agnostic core. Scripts, diagrams, and pronunciation overrides for a
specific product live in that product's own repository and are supplied as
input. The first consumer is [Vibrai](https://vibrai.com); nothing in this
repo is specific to it.

Design: [`docs/superpowers/specs/2026-08-20-cuecast-design.md`](docs/superpowers/specs/2026-08-20-cuecast-design.md).

## License

MIT — see [LICENSE](LICENSE).
