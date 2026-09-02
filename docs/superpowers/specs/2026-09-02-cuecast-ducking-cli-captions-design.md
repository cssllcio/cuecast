# cuecast — ducking, CLI, and captions, design

**Status:** design, awaiting maintainer review · **Date:** 2026-09-02
**Implements:** build-order steps 5 and 6 of
`docs/superpowers/specs/2026-08-20-cuecast-design.md` (§7). Steps 1–4 are
built and merged; step 7 (pilot integration into a consuming product) is
what this design exists to unblock.

---

## 1 · What this is

Three changes that turn the working pipeline into something another repo
can call:

- **Ducking.** `bed` beats play *under* narration at a reduced level.
- **A CLI.** `cuecast build video.json --out out.mp4`, invokable from any
  directory.
- **Captions.** WebVTT and SRT emitted from `text` and generated `timing`.

They are one design because the second and third are the same surface —
the CLI is what writes the caption files — and because all three are
prerequisites for the pilot, which is the next thing that happens.

## 2 · The timeline can't currently express ducking

This is the load-bearing finding, and it is why ducking is not a volume
prop.

`buildTimingTrack` lays every beat on a single back-to-back cursor: each
entry's `startSeconds` is the previous entry's `endSeconds`, `bed` beats
included. A bed therefore occupies its own exclusive slot on the
timeline and can never overlap narration. "Bed plays under narration" has
no timeline to be expressed on.

**Decision: bed beats become a parallel lane.** A bed beat no longer
advances the cursor. It starts where it sits in the script and runs for
its own probed audio length, over whatever narration follows.

The timeline invariant changes, and the new one must be stated in the
module header where the old one is stated today:

> Narration and silence entries are contiguous and gapless and define the
> video's length. Bed entries float over that spine and do not extend it.

Two consequences, both of which are edits, not opinions:

- A bed longer than the remaining video is **clamped to the spine's end**.
  A bed does not get to silently define how long the video is.
- The video's length is `Math.max` over all entries, not `timing.at(-1)`.
  Clamping does not make this redundant: `timing.at(-1)` is the last entry
  in *array* order, which is a bed whenever a script ends with one, and a
  bed's end is at or before the spine's. Two call sites read the last entry
  today and would both cut the video short.

A bed clamped to zero length — one placed after the last narration beat —
is a silent no-op. The pipeline reports it on stderr. This repo has
shipped two silent-audio bugs already (issue #1, PR #3); the third is not
free.

## 3 · Ducking is a mechanism, and the level is authored

The originating spec (§5) is explicit that no product-specific ducking
preset lives in this repo. That constrains the design more than it looks:
a hardcoded gain *is* a preset.

**Decision: the level is authored, the ramp is code.**

- `duckTo` — a new optional field on a `bed` beat, linear gain in `(0, 1]`,
  matching Remotion's `<Audio volume>` domain rather than dB. How far down
  a bed goes is taste, and taste is the product's.
- The ramp in and out is a fixed constant in the composition. How the gain
  gets from 1 to `duckTo` is mechanism, and mechanism is ours. One dial,
  not two.
- `duck` (already in the schema, currently inert) names the narration
  beats whose spans pull this bed down.

**A non-empty `duck` requires `duckTo`.** There is deliberately no default
to fall back on — that is the same rule as the previous paragraph, applied
where it would otherwise be quietly violated.

**Ids in `duck` are validated against the script.** A `duck` entry naming a
beat that doesn't exist, or naming a `silence` or `bed` beat, is rejected
at parse time. Today it would be accepted and duck nothing — the same
failure mode the narration client already guards against by refusing a
completed generation that reports no duration.

### The envelope

Gain over the bed is the **minimum** of a per-duck-span envelope, clamped
to `[duckTo, 1]`. Three awkward cases fall out of that formulation rather
than needing special cases:

- **Contiguous ducked beats.** Narration beats abut exactly. Two
  consecutively ducked beats must read as one duck region, with no ramp
  back up to 1 in the zero-width gap between them.
- **Crossing ramps.** Two duck regions closer together than two ramps have
  overlapping ramps; min-then-clamp keeps the result in range and
  monotonic.
- **Bed edges.** A ramp extending past either end of the bed is simply
  never sampled.

The envelope is evaluated in **seconds**, not frames. `src/timing/frames.ts`
states that its two conversions are meant to be the only ones in the
codebase — a note that exists because of issue #5 — and a seconds-domain
envelope introduces no third rounding rule.

## 4 · The CLI, and the three path domains

**Decision: a real compile step.** `tsc` emits `dist/`, and `bin` points
at `dist/cli/cuecast.js`. `npm run build` changes from a typecheck to an
emit; the typecheck becomes `npm run typecheck`.

The alternative — running TypeScript through a loader at invocation time —
avoids a build artifact but leaves the shipped thing untested and the
package unable to be consumed as a library. The pilot needs both.

Arg parsing is Node 20's built-in `node:util` `parseArgs`. `engines.node`
is already `">=20"`, and the repo's instinct is visibly to hand-roll small
things rather than take a dependency for them.

```
cuecast build <video.json> --out <out.mp4> [--work-dir <dir>] [--no-captions]
cuecast --help | --version
```

Arg parsing is a pure function returning a validated options object,
separate from the process entry point, so the CLI's behaviour is testable
in the fast suite without spawning anything.

### Path domains

A compiled bin can be invoked from anywhere. `renderVideo` today writes to
hardcoded cwd-relative paths and bundles Remotion from a literal
`src/remotion/Root.tsx`. Run from another repo — which is exactly what the
pilot does — all of it breaks. Three domains, kept apart deliberately:

| Domain | Resolved against | Holds |
|---|---|---|
| Package | `import.meta.url` | The Remotion entry point |
| Caller | `process.cwd()` | The `video.json` path, `--out` |
| Work | `.cuecast/<videoId>/`, or `--work-dir` | Every intermediate |

The work dir holds generated narration, copied bed audio, the rendered
SVG, and the resolved script — everything that goes to `generated/` and
`public/` today. It is handed to Remotion as `bundle({ publicDir })`, which
is what stops a run from another repo writing audio into cuecast's own
`node_modules`.

A `video.json`'s `diagram.source` resolves relative to **the script file**,
not to cwd. A script and the diagram it points at travel together; a
consuming product will keep both in its own docs tree.

`publicAudioPath`'s `audio/<videoId>/<beatId>` namespacing stays as it is.
The per-video work dir is an additional layer, not a replacement — PR #8's
two rationales (traversal and collision) are unaffected, and unwinding a
guard that was added deliberately in order to tidy a path is a bad trade.

## 5 · Captions

**Decision: WebVTT and SRT, both, written beside `--out`.** VTT is the
web-native format this pipeline's own output would use; SRT is what
editors and social platforms ingest. The second format is roughly ten
lines of formatter, and a product shipping to YouTube would otherwise
convert it by hand.

Cues come from `text` and **never** `spoken`. That split is the entire
reason both fields exist (§3 of the original design): respellings must not
reach anything a viewer reads.

Cues are built by joining `timing` to `script` on `beatId` and keeping only
narration beats. `silence` and `bed` entries carry no `text` at all, so
index alignment is not available; skipping them is also what gives the
caption track real gaps where the video is silent, instead of the abutting
spans the timeline itself produces.

Caption timestamps are a milliseconds conversion, not a frames conversion,
so they live with the caption code rather than in `frames.ts` — with a
comment saying so, because `frames.ts` asks any new seconds conversion to
justify itself.

The file stem comes from `--out`, not from the video id, so
`--out /tmp/demo.mp4` yields `/tmp/demo.vtt` and `/tmp/demo.srt`.

## 6 · Risks

- **The compile step is the risky change**, not ducking. It moves the
  pipeline entry point into `src/`, changes what `npm run build` does, and
  relocates every intermediate artifact. It should land on its own.
- **`Root.tsx` imports a test fixture at module scope** for its
  `defaultProps`. `test/` will not ship, so a published package's bundle
  would break. A minimal default belongs in `src/`.
- **A duck is hard to prove.** A whole-file level check cannot see one; the
  render test has to measure a ducked window against an open window and
  assert a real difference. Measuring the thing itself rather than a proxy
  is the house rule, and it is what caught issue #1.
- **Nothing here is verifiable from the repo root alone.** Whether the CLI
  actually works from another directory has to be checked from another
  directory, by hand, once.

## 7 · Explicitly out of scope

- Any product's ducking level, ramp preference, or caption styling.
- Caption positioning, speaker labels, or styled VTT cue settings — the
  export is plain cues over generated timing.
- Word-level caption timing. The service returns one duration per beat and
  no timestamps at all (see the narration-granularity spike); per-beat cues
  are the finest granularity the data supports.
- Publishing, distribution, or platform-specific caption dialects.
- The pilot integration itself (build-order step 7), which lands in the
  consuming product's own repo.
