# Caption Export (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write WebVTT and SRT caption files beside the rendered video, built from each narration beat's `text` and the timing that was generated for it.

**Architecture:** Two pure modules — one joins `timing` to `script` and keeps only narration beats, the other serialises those cues into the two formats. `renderVideo` writes both files next to `--out` unless the CLI's new `--no-captions` flag says otherwise.

**Tech Stack:** TypeScript 5 (strict), Vitest 2, Node >= 20. No new dependencies — both formats are a few lines of string building.

**Spec:** `docs/superpowers/specs/2026-09-02-cuecast-ducking-cli-captions-design.md` — this plan implements **§5**, the last unimplemented section. §2/§3 (ducking) shipped in PR #14; §4 (CLI, compile step, path domains) in PR #15.

## Global Constraints

- Node >= 20, TypeScript strict, Vitest 2. **No new dependencies.**
- **Cues come from `text` and never `spoken`.** That split is the entire reason both fields exist: respellings like `A P I` must not reach anything a viewer reads.
- Caption timestamps are a **milliseconds** conversion, not a frames conversion, so they live with the caption code rather than in `src/timing/frames.ts` — with a comment saying so, because `frames.ts` asks any new seconds conversion to justify itself (a note that exists because of issue #5).
- The file stem comes from `--out`, not from the video id: `--out /tmp/demo.mp4` yields `/tmp/demo.vtt` and `/tmp/demo.srt`.
- Unit tests (`npm test`, i.e. `vitest run src`) must never require a running service.
- `--no-captions` was deliberately deferred from Phase 2 as a flag no code read. This plan adds the flag and the behaviour together.

**Verified before this plan was written**, so no task needs to discover it:
- The timestamp values in Task 2 were produced by running the exact implementation that task specifies.
- `Math.round` rather than truncation is load-bearing: the timeline accumulates `cursorSeconds = entry.endSeconds`, producing values like `8.699999999999998`, where `Math.floor(s * 1000)` gives `8699` and `Math.round` gives the correct `8700`.
- `test/fixtures/example-video.json` has exactly 2 narration beats and 1 silence beat, with `text` values `"The API talks to the database."` / `"It reads and writes through SQL."` and `spoken` containing the respellings `A P I` and `S Q L`.

## File Structure

| File | Responsibility |
|---|---|
| `src/captions/cues.ts` (create) | Join timing to script; keep narration only. |
| `src/captions/format.ts` (create) | Serialise cues to WebVTT and SRT, including the milliseconds timestamp. |
| `src/pipeline/renderVideo.ts` (modify) | Write the two files beside `--out`. |
| `src/cli/parseArgs.ts`, `src/cli/cuecast.ts` (modify) | The `--no-captions` flag. |
| `test/integration/renderVideo.integration.test.ts`, `README.md` (modify) | Prove it against a real render; document it. |

---

## Task 1: Cues from narration beats

**Files:**
- Create: `src/captions/cues.ts`
- Test: `src/captions/cues.test.ts`

**Interfaces:**
- Consumes: `VideoScript` from `src/schema/videoScript.js`.
- Produces:
  ```ts
  export interface Cue { startSeconds: number; endSeconds: number; text: string }
  export function buildCues(videoScript: VideoScript): Cue[];
  ```
  Tasks 2 and 3 consume both.

- [ ] **Step 1: Write the failing test**

```ts
// src/captions/cues.test.ts
import { describe, expect, it } from "vitest";
import type { VideoScript } from "../schema/videoScript.js";
import { buildCues } from "./cues.js";

const script: VideoScript = {
  id: "v1",
  diagram: { source: "d.mmd", revealGroups: {} },
  pronunciations: {},
  script: [
    { id: "beat_01", type: "narration", text: "The API talks to it.", spoken: "The A P I talks to it." },
    { id: "gap", type: "silence", duration: 1 },
    { id: "music", type: "bed", audio: "m.wav" },
    { id: "beat_02", type: "narration", text: "It writes through SQL.", spoken: "It writes through S Q L." },
  ],
  timing: [
    { beatId: "beat_01", startSeconds: 0, endSeconds: 1.86 },
    { beatId: "gap", startSeconds: 1.86, endSeconds: 2.86 },
    { beatId: "music", startSeconds: 1.86, endSeconds: 2.86 },
    { beatId: "beat_02", startSeconds: 2.86, endSeconds: 5.28 },
  ],
};

describe("buildCues", () => {
  // The caption track should have a real hole where the video is silent.
  // The timeline itself has none — narration and silence abut exactly — so
  // dropping non-narration entries is what creates the gap.
  it("emits one cue per narration beat, skipping silence and bed", () => {
    expect(buildCues(script)).toEqual([
      { startSeconds: 0, endSeconds: 1.86, text: "The API talks to it." },
      { startSeconds: 2.86, endSeconds: 5.28, text: "It writes through SQL." },
    ]);
  });

  // The whole reason the schema carries both fields: a respelling must never
  // reach anything a viewer reads.
  it("uses text, never spoken", () => {
    for (const cue of buildCues(script)) {
      expect(cue.text).not.toMatch(/A P I|S Q L/);
    }
  });

  it("returns nothing for a script with no narration", () => {
    expect(
      buildCues({
        ...script,
        script: [{ id: "gap", type: "silence", duration: 1 }],
        timing: [{ beatId: "gap", startSeconds: 0, endSeconds: 1 }],
      })
    ).toEqual([]);
  });

  // A script parsed but never rendered has an empty timing block, and asking
  // for captions before generation is a plausible mistake rather than a crash.
  it("returns nothing when timing has not been generated yet", () => {
    expect(buildCues({ ...script, timing: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/captions/cues.test.ts`
Expected: FAIL — cannot find module `./cues.js`.

- [ ] **Step 3: Implement**

```ts
// src/captions/cues.ts
import type { VideoScript } from "../schema/videoScript.js";

export interface Cue {
  startSeconds: number;
  endSeconds: number;
  /** What a viewer reads. Never a beat's `spoken` respelling. */
  text: string;
}

/**
 * The caption track for a rendered script.
 *
 * Joins `timing` to `script` on `beatId` and keeps only narration beats.
 * `silence` and `bed` entries carry no `text` at all, so index alignment is
 * not available — and skipping them is also what gives the caption track real
 * gaps where the video is silent, instead of the abutting spans the timeline
 * itself produces.
 *
 * Cues come out in timeline order without sorting: narration entries are laid
 * out contiguously by buildTimingTrack, so they are already ascending. Bed
 * entries float over that spine and can appear out of order, but they are
 * dropped here.
 */
export function buildCues(videoScript: VideoScript): Cue[] {
  const textByBeatId = new Map<string, string>();
  for (const beat of videoScript.script) {
    if (beat.type === "narration") {
      textByBeatId.set(beat.id, beat.text);
    }
  }

  const cues: Cue[] = [];
  for (const entry of videoScript.timing) {
    const text = textByBeatId.get(entry.beatId);
    if (text === undefined) continue;
    cues.push({
      startSeconds: entry.startSeconds,
      endSeconds: entry.endSeconds,
      text,
    });
  }
  return cues;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/captions/cues.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/captions/cues.ts src/captions/cues.test.ts
git commit -m "feat: build caption cues from narration beats and generated timing"
```

---

## Task 2: WebVTT and SRT

**Files:**
- Create: `src/captions/format.ts`
- Test: `src/captions/format.test.ts`

**Interfaces:**
- Consumes: `Cue` (Task 1).
- Produces: `export function formatVtt(cues: Cue[]): string` and `export function formatSrt(cues: Cue[]): string`. Task 3 calls both.

- [ ] **Step 1: Write the failing test**

Every timestamp below was produced by running the Step 3 implementation. If one disagrees, the implementation is wrong — do not adjust the expectation.

```ts
// src/captions/format.test.ts
import { describe, expect, it } from "vitest";
import type { Cue } from "./cues.js";
import { formatSrt, formatVtt } from "./format.js";

const cues: Cue[] = [
  { startSeconds: 0, endSeconds: 1.86, text: "The API talks to it." },
  { startSeconds: 2.86, endSeconds: 5.28, text: "It writes through SQL." },
];

describe("formatVtt", () => {
  it("writes a WEBVTT header and one cue per entry", () => {
    expect(formatVtt(cues)).toBe(
      [
        "WEBVTT",
        "",
        "00:00:00.000 --> 00:00:01.860",
        "The API talks to it.",
        "",
        "00:00:02.860 --> 00:00:05.280",
        "It writes through SQL.",
        "",
      ].join("\n")
    );
  });

  // An empty track is still a valid VTT file; a consumer that loads it should
  // see no cues rather than a parse error.
  it("still writes the header with no cues", () => {
    expect(formatVtt([])).toBe("WEBVTT\n");
  });
});

describe("formatSrt", () => {
  // SRT differs from VTT in exactly three ways: no header, 1-based indices,
  // and a comma before the milliseconds.
  it("numbers cues from one and separates milliseconds with a comma", () => {
    expect(formatSrt(cues)).toBe(
      [
        "1",
        "00:00:00,000 --> 00:00:01,860",
        "The API talks to it.",
        "",
        "2",
        "00:00:02,860 --> 00:00:05,280",
        "It writes through SQL.",
        "",
      ].join("\n")
    );
  });

  it("is empty with no cues", () => {
    expect(formatSrt([])).toBe("");
  });
});

describe("timestamps", () => {
  it("pads hours, minutes, seconds and milliseconds", () => {
    const at = (seconds: number) =>
      formatVtt([{ startSeconds: seconds, endSeconds: seconds, text: "x" }])
        .split("\n")[2]
        .split(" --> ")[0];

    expect(at(0)).toBe("00:00:00.000");
    expect(at(0.5)).toBe("00:00:00.500");
    expect(at(59.999)).toBe("00:00:59.999");
    expect(at(60)).toBe("00:01:00.000");
    expect(at(61.5)).toBe("00:01:01.500");
    expect(at(3599.999)).toBe("00:59:59.999");
    expect(at(3600)).toBe("01:00:00.000");
    expect(at(3661.25)).toBe("01:01:01.250");
  });

  // buildTimingTrack accumulates `cursorSeconds = entry.endSeconds`, so real
  // spans arrive as sums of floats. Truncating this one gives 8699 — an
  // off-by-a-millisecond that only shows up on certain values.
  it("rounds to the nearest millisecond rather than truncating", () => {
    const at = (seconds: number) =>
      formatVtt([{ startSeconds: seconds, endSeconds: seconds, text: "x" }])
        .split("\n")[2]
        .split(" --> ")[0];

    expect(at(8.699999999999998)).toBe("00:00:08.700");
    expect(at(2.8600000000000003)).toBe("00:00:02.860");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/captions/format.test.ts`
Expected: FAIL — cannot find module `./format.js`.

- [ ] **Step 3: Implement**

```ts
// src/captions/format.ts
import type { Cue } from "./cues.js";

/**
 * Seconds to a caption timestamp.
 *
 * This lives here rather than in src/timing/frames.ts deliberately. That file
 * asks any new seconds conversion to justify itself, and its two conversions
 * are both to *frames*; this one is to milliseconds, for a text format that
 * knows nothing about fps. Adding it there would make "the only two
 * conversions" false without making anything simpler.
 *
 * Rounds rather than truncates. buildTimingTrack accumulates
 * `cursorSeconds = entry.endSeconds`, so a real span can arrive as
 * 8.699999999999998, which truncation would render as 08.699.
 */
function formatTimestamp(seconds: number, msSeparator: string): string {
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = (totalMs - ms) / 1000;
  const s = totalSeconds % 60;
  const totalMinutes = (totalSeconds - s) / 60;
  const m = totalMinutes % 60;
  const h = (totalMinutes - m) / 60;

  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${msSeparator}${pad(ms, 3)}`;
}

/** WebVTT: a header, then blank-line-separated cues with `.` before the ms. */
export function formatVtt(cues: Cue[]): string {
  const blocks = cues.map(
    (cue) =>
      `${formatTimestamp(cue.startSeconds, ".")} --> ${formatTimestamp(cue.endSeconds, ".")}\n` +
      `${cue.text}\n`
  );
  return `WEBVTT\n${blocks.map((block) => `\n${block}`).join("")}`;
}

/** SRT: no header, 1-based indices, `,` before the ms. */
export function formatSrt(cues: Cue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n` +
        `${formatTimestamp(cue.startSeconds, ",")} --> ${formatTimestamp(cue.endSeconds, ",")}\n` +
        `${cue.text}\n`
    )
    .join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/captions/format.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/captions/format.ts src/captions/format.test.ts
git commit -m "feat: serialise caption cues to WebVTT and SRT"
```

---

## Task 3: Write them beside the video

**Files:**
- Modify: `src/pipeline/renderVideo.ts`
- Modify: `src/cli/parseArgs.ts`, `src/cli/cuecast.ts`
- Test: `src/cli/parseArgs.test.ts`
- Modify: `test/integration/renderVideo.integration.test.ts`, `README.md`

**Interfaces:**
- Consumes: `buildCues` (Task 1), `formatVtt` / `formatSrt` (Task 2).
- Produces: `RenderVideoOptions` gains `captions: boolean`; `BuildCommand` gains `captions: boolean`.

- [ ] **Step 1: Write the failing CLI test**

Append to `src/cli/parseArgs.test.ts`:

```ts
describe("--no-captions", () => {
  it("defaults to writing captions", () => {
    expect(parseCliArgs(["build", "v.json", "--out", "o.mp4"])).toMatchObject({
      captions: true,
    });
  });

  it("turns them off", () => {
    expect(
      parseCliArgs(["build", "v.json", "--out", "o.mp4", "--no-captions"])
    ).toMatchObject({ captions: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/cli/parseArgs.test.ts`
Expected: FAIL — the returned object has no `captions` property.

- [ ] **Step 3: Add the flag**

In `src/cli/parseArgs.ts`, add to `BuildCommand`:

```ts
  /** Whether to write .vtt and .srt beside the video. */
  captions: boolean;
```

Add to the `options` object passed to `parseArgs`:

```ts
        "no-captions": { type: "boolean" },
```

And to the returned build command, alongside the existing fields:

```ts
    captions: parsed.values["no-captions"] !== true,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/cli/parseArgs.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the caption files**

In `src/pipeline/renderVideo.ts`, add the imports:

```ts
import { basename, dirname, extname, join, resolve } from "node:path";
import { buildCues } from "../captions/cues.js";
import { formatSrt, formatVtt } from "../captions/format.js";
```

(`dirname`, `join` and `resolve` are already imported from `node:path` — extend that line rather than adding a second, and add `basename` and `extname` to it.)

Add the option:

```ts
export interface RenderVideoOptions {
  /** Absolute path to the video.json. */
  scriptPath: string;
  /** Absolute path to write the rendered mp4 to. */
  outPath: string;
  /** Absolute directory for this run's intermediates. */
  workDir: string;
  /** Write .vtt and .srt beside the video. */
  captions: boolean;
}
```

and destructure `captions` alongside the others.

Then, immediately after the `renderMedia` call at the end of the function:

```ts
  if (captions) {
    // Beside the video, sharing its name: --out /tmp/demo.mp4 gives
    // /tmp/demo.vtt and /tmp/demo.srt. Keyed off outPath rather than the video
    // id, so a caller who renamed the output gets captions that match it.
    const stem = join(dirname(outPath), basename(outPath, extname(outPath)));
    const cues = buildCues(finalVideoScript);
    writeFileSync(`${stem}.vtt`, formatVtt(cues));
    writeFileSync(`${stem}.srt`, formatSrt(cues));
  }
```

- [ ] **Step 6: Pass the flag through the CLI**

In `src/cli/cuecast.ts`, add `captions: command.captions,` to the `renderVideo({ ... })` call.

Also add the flag to the `USAGE` block, under the existing `--work-dir` line:

```
  --no-captions      Skip the .vtt and .srt written beside the video.
```

- [ ] **Step 7: Fix the other callers**

`renderVideo` gained a required option, so every existing call must pass it. In `test/integration/renderVideo.integration.test.ts` there are three `renderVideo({ ... })` calls; add `captions: true` to each. Run `npm run typecheck` to confirm none were missed — a missing one is a compile error, not a silent default.

- [ ] **Step 8: Prove it against a real render**

Append to the existing `describe.skipIf(!baseUrl)` block in `test/integration/renderVideo.integration.test.ts`:

```ts
  it("writes captions beside the video, from text rather than spoken", async () => {
    const outPath = resolve("out/captions-proof.mp4");
    await renderVideo({
      scriptPath: resolve("test/fixtures/example-video.json"),
      outPath,
      workDir: resolve(".cuecast/captions_proof"),
      captions: true,
    });

    const vtt = readFileSync(resolve("out/captions-proof.vtt"), "utf-8");
    const srt = readFileSync(resolve("out/captions-proof.srt"), "utf-8");

    expect(vtt.startsWith("WEBVTT")).toBe(true);
    // example-video.json has two narration beats and one silence beat; the
    // silence must not become a cue.
    expect(vtt.match(/-->/g)).toHaveLength(2);
    expect(srt.match(/-->/g)).toHaveLength(2);

    // The respellings live in the fixture's `spoken` fields. If either reaches
    // a caption, the text/spoken split has failed at the only point it matters.
    for (const captions of [vtt, srt]) {
      expect(captions).toContain("The API talks to the database.");
      expect(captions).not.toContain("A P I");
      expect(captions).not.toContain("S Q L");
    }
  }, 600_000);
```

Add `readFileSync` to that file's `node:fs` import if it is not already there.

- [ ] **Step 9: Run everything**

Run: `npm test && npm run typecheck && npm run build && npm run test:render`
Then, with a live Voicebox:
`CUECAST_TTS_URL=http://127.0.0.1:17493 CUECAST_TTS_PROFILE_ID=<profile> npx vitest run test/integration --no-file-parallelism`

Expected: all green. `--no-file-parallelism` is required — two integration files generating concurrently wedged a local Voicebox on 2026-09-02 and it needed a manual restart.

- [ ] **Step 10: Update the README**

In the "How it works" list of deliberate decisions, the pronunciation bullet already says `text` is "for captions". Extend the sentence that describes the CLI, under "Running it", to mention what else a build produces:

```markdown
A build writes the video, plus `.vtt` and `.srt` captions beside it built from
each narration beat's `text` — never its `spoken` respelling. Pass
`--no-captions` to skip them.
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: write WebVTT and SRT captions beside the rendered video"
```

---

## Self-Review Notes

**Spec coverage.** §5's "WebVTT and SRT, both, written beside `--out`" → Task 3 Step 5. "Cues come from `text` and never `spoken`" → Task 1's dedicated test and Task 3's integration assertion, which checks the rendered files rather than the function. "Joining `timing` to `script` on `beatId` and keeping only narration beats" → Task 1. "Skipping them is what gives the caption track real gaps" → Task 1's first test, whose fixture has a silence beat between two narration beats. "Timestamps are a milliseconds conversion… with a comment saying so" → Task 2's `formatTimestamp` doc comment. "The file stem comes from `--out`, not from the video id" → Task 3 Step 5, with a test asserting the file lands at the `--out` stem. `--no-captions`, deferred from Phase 2 as a flag nothing read → Task 3 Steps 1-3 and 6, which add the flag and the behaviour together.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. The `<profile>` in Task 3 Step 9 is a runtime argument the operator supplies.

**Type consistency.** `Cue` is `{ startSeconds, endSeconds, text }` in Task 1's definition and Task 2's import. `buildCues(videoScript: VideoScript): Cue[]`, `formatVtt(cues: Cue[]): string` and `formatSrt(cues: Cue[]): string` are defined in Tasks 1-2 and called with those exact signatures in Task 3. `captions: boolean` is added to both `RenderVideoOptions` and `BuildCommand` and flows CLI → pipeline unchanged.

**Ordering.** Tasks 1 and 2 are independent of everything else, though 2 imports 1's type. Task 3 needs both, and is the only task requiring a live TTS service — and only for its Step 8.
