# Reproducible Narration (Seeded Generation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an unchanged `video.json` render to identical narration and identical timing every time, by sending Voicebox a seed derived from each beat's identity.

**Architecture:** A pure `beatSeed(videoId, beatId)` hash supplies a default seed per narration beat; an optional `seed` on the beat overrides it. `NarrationClient.generate` takes the seed as a required parameter and asserts the service echoes it back. The resolved seed is recorded into the generated `timing` entry alongside `audioPath`.

**Tech Stack:** TypeScript 5 (strict), Vitest 2, Zod 3, Node >= 20. No new dependencies — the hash is hand-rolled by design.

**Spec:** `docs/superpowers/specs/2026-09-02-cuecast-narration-seed-design.md` (issue #11)

## Global Constraints

- **Base this work on `fix/render-hang-and-dead-lexicon` (PR #10), not on `main`.** Task 4 edits the line `const spoken = spokenForBeat(beat, lexicon);`, which only exists after that PR.
- Seeds are integers `>= 0`. Voicebox rejects a negative seed with HTTP 422 (`{"type":"greater_than_equal","loc":["body","seed"]}`).
- **`beatSeed`'s output must never change.** It is a compatibility surface: changing it silently invalidates the reproducibility of every render ever made (spec §3). The golden test in Task 1 exists to make that impossible to do by accident.
- Seeds apply to narration beats only. `bed` beats are supplied assets and `silence` is authored duration; neither reaches the TTS (spec §8).
- No product-specific seed values in this repo — those live in the consuming product's own `video.json`.
- Unit tests (`npm test`) must never require a running service. Anything needing Voicebox goes in `test/integration/`.
- Reproducibility is per-engine and per-profile. A seed fixes sampling, not the model (spec §7).

## File Structure

| File | Responsibility |
|---|---|
| `src/narration/beatSeed.ts` (create) | The derivation. Pure, no imports, frozen forever. |
| `src/schema/videoScript.ts` (modify) | `seed?` on a narration beat (authored) and on a timing entry (generated). |
| `src/narration/narrationClient.ts` (modify) | Send the seed; assert the echo. |
| `scripts/render-video.ts` (modify) | Resolve `beat.seed ?? beatSeed(...)`, pass it, record it. |
| `scripts/fixture-test.ts` (modify) | Three fixed seeds per lexicon term. |
| `docs/fixture-test-procedure.md` (modify) | Why three seeds, and why repeating one proves nothing. |
| `README.md` (modify) | Renders are reproducible. |

---

## Task 1: The seed derivation

**Files:**
- Create: `src/narration/beatSeed.ts`
- Test: `src/narration/beatSeed.test.ts`

**Interfaces:**
- Consumes: nothing. Deliberately dependency-free.
- Produces: `export function beatSeed(videoId: string, beatId: string): number` — called by Task 4.

- [ ] **Step 1: Write the failing test**

The golden values below were computed from the exact implementation in Step 3 and verified. Do not adjust them to match a different implementation — if they disagree, the implementation is wrong.

```ts
// src/narration/beatSeed.test.ts
import { describe, expect, it } from "vitest";
import { beatSeed } from "./beatSeed.js";

describe("beatSeed", () => {
  // These values are a compatibility surface, not an implementation detail.
  // Every render ever made is reproducible only while they hold. If a change
  // to beatSeed breaks this test, the correct response is to revert the
  // change, not to update the numbers.
  it("returns known values for known inputs", () => {
    expect(beatSeed("example_video", "beat_01")).toBe(1815404907);
    expect(beatSeed("example_video", "beat_03")).toBe(1848960145);
    expect(beatSeed("other_video", "beat_01")).toBe(1351394639);
    expect(beatSeed("render_proof", "beat_01")).toBe(1397914454);
  });

  it("is deterministic", () => {
    expect(beatSeed("example_video", "beat_01")).toBe(
      beatSeed("example_video", "beat_01")
    );
  });

  it("gives different beats different seeds", () => {
    expect(beatSeed("example_video", "beat_01")).not.toBe(
      beatSeed("example_video", "beat_03")
    );
  });

  // The same beat id in two videos must not draw the same audio — the same
  // reasoning that made publicAudioPath namespace by video id in PR #8.
  it("gives the same beat id in different videos different seeds", () => {
    expect(beatSeed("example_video", "beat_01")).not.toBe(
      beatSeed("other_video", "beat_01")
    );
  });

  // Beat ids are unvalidated strings, so a printable separator would collide:
  // under a space, ("a b","c") and ("a","b c") both key to "a b c".
  it("does not collide when an id contains the separator's printable cousin", () => {
    expect(beatSeed("a b", "c")).not.toBe(beatSeed("a", "b c"));
  });

  // Voicebox rejects a negative seed with HTTP 422, and its schema caps
  // nothing above, so staying inside signed 32-bit is the safe range.
  it("always returns a non-negative integer below 2^31", () => {
    for (const id of ["a", "beat_01", "x".repeat(200), "unicode-é"]) {
      const seed = beatSeed("video", id);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 31);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/narration/beatSeed.test.ts`
Expected: FAIL — cannot find module `./beatSeed.js`.

- [ ] **Step 3: Implement the derivation**

```ts
// src/narration/beatSeed.ts

/**
 * The default seed for a narration beat, derived from its identity.
 *
 * FNV-1a, 32-bit, masked to 31 bits. Hand-rolled rather than taken from a
 * dependency or from anything environment-provided because this output must be
 * stable across Node versions and platforms *forever*: it is what makes an
 * unchanged video.json reproduce, and changing it invalidates the
 * reproducibility of every render ever made without anything announcing it.
 * Golden values are pinned in the test for exactly that reason.
 *
 * Keyed on identity rather than position, unlike Vibrai's vo.sh
 * (SEED_BASE + line index). Inserting a beat there re-rolls every beat after
 * it; here, where the output *is* the timing, that would make a one-line edit
 * re-render the whole remainder of the video.
 */

// NUL, because ids are unvalidated strings and any printable separator
// collides: under a space, ("a b","c") and ("a","b c") key identically.
const SEPARATOR = String.fromCharCode(0);

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function beatSeed(videoId: string, beatId: string): number {
  const key = videoId + SEPARATOR + beatId;
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i) & 0xff;
    // Math.imul keeps the multiply in 32-bit; a plain * loses precision
    // above 2^53 and would make the hash platform-sensitive.
    hash = Math.imul(hash, FNV_PRIME);
  }
  // >>> 0 to unsigned, then drop the sign bit: Voicebox requires seed >= 0.
  return (hash >>> 0) & 0x7fffffff;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/narration/beatSeed.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/narration/beatSeed.ts src/narration/beatSeed.test.ts
git commit -m "feat: derive a stable per-beat narration seed"
```

---

## Task 2: Schema fields

**Files:**
- Modify: `src/schema/videoScript.ts`
- Test: `src/schema/videoScript.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `NarrationBeat.seed?: number` (authored override) and `TimingEntry.seed?: number` (generated record), both used by Task 4.

- [ ] **Step 1: Write the failing test**

Append to `src/schema/videoScript.test.ts`. The existing `validScript` const at the top of that file is reused.

```ts
describe("seed", () => {
  it("accepts a narration beat with an explicit seed", () => {
    const parsed = parseVideoScript({
      ...validScript,
      script: [{ ...validScript.script[0], seed: 4000 }],
    });
    expect(parsed.script[0]).toMatchObject({ seed: 4000 });
  });

  it("accepts a narration beat with no seed", () => {
    const parsed = parseVideoScript(validScript);
    expect(parsed.script[0]).not.toHaveProperty("seed");
  });

  it("accepts zero", () => {
    expect(() =>
      parseVideoScript({
        ...validScript,
        script: [{ ...validScript.script[0], seed: 0 }],
      })
    ).not.toThrow();
  });

  // Voicebox answers a negative seed with HTTP 422, so rejecting it at parse
  // time turns a wasted round trip into an immediate, local error.
  it("rejects a negative seed", () => {
    expect(() =>
      parseVideoScript({
        ...validScript,
        script: [{ ...validScript.script[0], seed: -1 }],
      })
    ).toThrow();
  });

  it("rejects a fractional seed", () => {
    expect(() =>
      parseVideoScript({
        ...validScript,
        script: [{ ...validScript.script[0], seed: 1.5 }],
      })
    ).toThrow();
  });

  it("records a seed on a timing entry", () => {
    const parsed = parseVideoScript({
      ...validScript,
      timing: [
        { beatId: "beat_01", startSeconds: 0, endSeconds: 2.4, seed: 4000 },
      ],
    });
    expect(parsed.timing[0]).toMatchObject({ seed: 4000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/schema/videoScript.test.ts`
Expected: FAIL — the negative and fractional cases do not throw, because zod strips unknown keys rather than validating them, and the accept cases find no `seed` property.

- [ ] **Step 3: Add the fields**

In `src/schema/videoScript.ts`, add `seed` to `narrationBeatSchema`:

```ts
const narrationBeatSchema = z.object({
  id: z.string(),
  type: z.literal("narration"),
  text: z.string(),
  spoken: z.string(),
  reveal: z.array(z.string()).optional(),
  // Authored escape hatch from a bad take. Absent means derived from the
  // beat's identity — see src/narration/beatSeed.ts.
  seed: z.number().int().nonnegative().optional(),
});
```

and to `timingEntrySchema`:

```ts
const timingEntrySchema = z.object({
  beatId: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  audioPath: z.string().optional(),
  // Generated, never authored: the seed this beat's audio was actually made
  // with, so a past render is explicable without re-deriving anything.
  // Narration-only, like audioPath — silence and bed beats never reach the TTS.
  seed: z.number().int().nonnegative().optional(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/schema/videoScript.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/videoScript.ts src/schema/videoScript.test.ts
git commit -m "feat: allow an authored seed on a beat and record one on timing"
```

---

## Task 3: Send the seed and verify it took effect

**Files:**
- Modify: `src/narration/narrationClient.ts`
- Test: `src/narration/narrationClient.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: `generate(spokenText: string, seed: number): Promise<GenerateResult>` — the second parameter is **required**. Task 4 calls it.

Note: making `seed` required changes an existing signature. The existing test `"posts text, profile and engine to /generate"` and every other `client.generate(...)` call in this file must be updated to pass a seed; Step 1 shows the updated form.

- [ ] **Step 1: Write the failing test**

Update the existing first test and add two. The `routedFetch` helper already in the file needs its `/history` body to carry a seed, so extend its call sites via the `historyStatuses` argument.

```ts
  it("posts text, profile, engine and seed to /generate", async () => {
    const fetchImpl = routedFetch([
      { status: "completed", duration: 3.22, error: null, seed: 4000 },
    ]);
    const client = new NarrationClient({
      baseUrl: BASE,
      profileId: "test-profile",
      audioOutputDir,
      engine: "chatterbox",
      fetchImpl,
      sleepImpl,
    });

    await client.generate("hello world", 4000);

    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      text: "hello world",
      profile_id: "test-profile",
      engine: "chatterbox",
      seed: 4000,
    });
  });

  // If the service ignored the seed, every render would look correct while
  // reproducibility was quietly gone — the shape of issue #1, where the file
  // existed and the audio did not. Verified live on 2026-09-02: Voicebox
  // echoes the seed on both /generate and /history.
  it("throws when the service reports a different seed than the one sent", async () => {
    const fetchImpl = routedFetch([
      { status: "completed", duration: 3.22, error: null, seed: 9999 },
    ]);
    const client = new NarrationClient({
      baseUrl: BASE,
      profileId: "test-profile",
      audioOutputDir,
      fetchImpl,
      sleepImpl,
    });

    await expect(client.generate("hello world", 4000)).rejects.toThrow(
      /seed/i
    );
  });

  it("accepts a completed generation that reports no seed at all", async () => {
    // Absent is not the same as wrong: an older service build may omit the
    // field. Only a contradiction is an error.
    const fetchImpl = routedFetch([
      { status: "completed", duration: 3.22, error: null },
    ]);
    const client = new NarrationClient({
      baseUrl: BASE,
      profileId: "test-profile",
      audioOutputDir,
      fetchImpl,
      sleepImpl,
    });

    await expect(client.generate("hello world", 4000)).resolves.toMatchObject({
      durationSeconds: 3.22,
    });
  });
```

Also update every other `client.generate("...")` call already in this file to `client.generate("...", 4000)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/narration/narrationClient.test.ts`
Expected: FAIL — the posted body has no `seed`, and the mismatch case resolves instead of throwing.

- [ ] **Step 3: Implement**

In `src/narration/narrationClient.ts`, extend the history response type:

```ts
interface HistoryResponse {
  status: string;
  duration: number | null;
  error: string | null;
  seed?: number | null;
}
```

Change `generate` and `startGeneration` to take the seed, and thread it into `waitForCompletion`:

```ts
  async generate(spokenText: string, seed: number): Promise<GenerateResult> {
    const id = await this.startGeneration(spokenText, seed);
    const durationSeconds = await this.waitForCompletion(id, seed);
    const audioPath = await this.fetchAudio(id);
    return { audioPath, durationSeconds };
  }

  private async startGeneration(spokenText: string, seed: number): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: spokenText,
        profile_id: this.profileId,
        engine: this.engine,
        seed,
      }),
    });
    if (!response.ok) {
      throw new Error(`narration /generate failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as GenerateResponse;
    return body.id;
  }
```

In `waitForCompletion`, add the parameter and the echo check inside the `completed` branch, immediately after the existing duration guard:

```ts
  private async waitForCompletion(id: string, seed: number): Promise<number> {
```

```ts
      if (body.status === "completed") {
        if (body.duration === null || body.duration === undefined) {
          throw new Error(`narration generation ${id} completed with no duration reported`);
        }
        // A seed the service silently ignored would leave every render looking
        // fine while reproducibility was gone. Absent is tolerated (an older
        // build may not report it); contradicting the request is not.
        if (body.seed !== null && body.seed !== undefined && body.seed !== seed) {
          throw new Error(
            `narration generation ${id} used seed ${body.seed}, not the requested ${seed}`
          );
        }
        return body.duration;
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/narration/narrationClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/narration/narrationClient.ts src/narration/narrationClient.test.ts
git commit -m "feat: send a seed with every generation and verify it took effect"
```

---

## Task 4: Wire it through the pipeline

**Files:**
- Modify: `scripts/render-video.ts`
- Modify: `test/integration/renderVideo.integration.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `beatSeed` (Task 1), `NarrationBeat.seed` / `TimingEntry.seed` (Task 2), `generate(text, seed)` (Task 3).
- Produces: `generated/current-render-video.json` whose timing entries carry `seed`.

- [ ] **Step 1: Write the failing integration test**

Append inside the existing `describe.skipIf(!baseUrl)` block in `test/integration/renderVideo.integration.test.ts`:

```ts
  // The property the whole change exists for. A file-level or duration-level
  // check would not catch a timing track that drifts; comparing the tracks
  // themselves is the thing itself.
  it("renders the same script to the same timing twice", async () => {
    const readTiming = () =>
      JSON.parse(
        readFileSync("generated/current-render-video.json", "utf-8")
      ).timing;

    await renderVideo("test/fixtures/example-video.json", "out/repro-a.mp4");
    const first = readTiming();

    await renderVideo("test/fixtures/example-video.json", "out/repro-b.mp4");
    const second = readTiming();

    expect(second).toEqual(first);
    // Guard against the test passing vacuously if timing were ever empty.
    expect(first.length).toBeGreaterThan(0);
    expect(first.some((entry: { seed?: number }) => entry.seed !== undefined)).toBe(true);
  }, 600_000);
```

Add `readFileSync` to the `node:fs` import at the top of that file.

- [ ] **Step 2: Run to verify it fails**

Run: `CUECAST_TTS_URL=http://127.0.0.1:17493 CUECAST_TTS_PROFILE_ID=<profile> npx vitest run test/integration/renderVideo.integration.test.ts --no-file-parallelism`
Expected: FAIL — the two timing tracks differ, and no entry carries a seed.

Note `--no-file-parallelism`: two integration files generating concurrently wedged the local Voicebox on 2026-09-02 (worker died, jobs stuck at `loading_model`, requiring a restart).

- [ ] **Step 3: Resolve and record the seed**

In `scripts/render-video.ts`, add the import:

```ts
import { beatSeed } from "../src/narration/beatSeed.js";
```

Add a seeds map beside the existing `durations` and `audioPaths` maps:

```ts
  const durations = new Map<string, number>();
  const audioPaths = new Map<string, string>();
  const seeds = new Map<string, number>();
```

Change the narration branch of the beat loop:

```ts
    if (beat.type === "narration") {
      const spoken = spokenForBeat(beat, lexicon);
      const seed = beat.seed ?? beatSeed(videoScript.id, beat.id);
      const { audioPath, durationSeconds } = await client.generate(spoken, seed);
      durations.set(beat.id, durationSeconds);
      seeds.set(beat.id, seed);
      audioPaths.set(beat.id, copyBeatAudioToPublic(beat.id, audioPath));
    } else if (beat.type === "bed") {
```

Record it when building the timing track:

```ts
  const timing = buildTimingTrack(videoScript.script, durations).map(
    (entry) => {
      const audioPath = audioPaths.get(entry.beatId);
      const seed = seeds.get(entry.beatId);
      return {
        ...entry,
        ...(audioPath ? { audioPath } : {}),
        ...(seed !== undefined ? { seed } : {}),
      };
    }
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `CUECAST_TTS_URL=http://127.0.0.1:17493 CUECAST_TTS_PROFILE_ID=<profile> npx vitest run test/integration/renderVideo.integration.test.ts --no-file-parallelism`
Expected: PASS. Takes roughly 4 minutes — two full renders.

- [ ] **Step 5: Update the README**

In the "How it works" paragraph, replace:

```
reads them as data. Edit the script, rebuild, reveals re-sync.
```

with:

```
reads them as data. Edit the script, rebuild, reveals re-sync — and an
unchanged script rebuilds to byte-identical narration, because every
generation is seeded from the beat's identity. Write a `seed` on a beat to
choose a different take.
```

- [ ] **Step 6: Run the full unit suite and typecheck**

Run: `npm test && npm run build`
Expected: PASS, and `tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add scripts/render-video.ts test/integration/renderVideo.integration.test.ts README.md
git commit -m "feat: seed every narration beat so timing is reproducible"
```

---

## Task 5: Make the fixture test judgeable

**Files:**
- Modify: `scripts/fixture-test.ts`
- Modify: `docs/fixture-test-procedure.md`

**Interfaces:**
- Consumes: `generate(text, seed)` (Task 3).
- Produces: `generated/fixture-test/manifest.json` entries of `{ term, respelling, seed, audioPath }`.

There is no unit test here: this script's whole output is audio for a human to judge, and its correctness condition is "a person can tell whether the respelling is right." Asserting on it in code would test the mock, not the thing. It is verified by running it (Step 3).

- [ ] **Step 1: Generate three fixed seeds per term**

Replace the generation loop in `scripts/fixture-test.ts`:

```ts
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
```

- [ ] **Step 2: Update the procedure doc**

Replace step 2 of `docs/fixture-test-procedure.md` and add a rationale paragraph:

```markdown
2. Listen to every file listed in `generated/fixture-test/manifest.json`. Each
   term appears three times, once per seed. Judge the term, not the take: a
   respelling is right if it reads correctly on all three.

Why three seeds, and why fixed: generation is deterministic given a seed, so
repeating one seed produces byte-identical audio and proves nothing. Different
seeds produce genuinely different takes — the same sentence has measured 1.52s
on one seed and 4.22s on another — and a single take can be pathological. One
unseeded take of `sett` came back at 6.64 seconds for one word on 2026-09-02,
which would have condemned a good respelling had anyone judged it on that alone.
Fixed seeds mean two people running this procedure hear the same audio.
```

- [ ] **Step 3: Run it against a real service and confirm the output**

Run: `CUECAST_TTS_URL=http://127.0.0.1:17493 CUECAST_TTS_PROFILE_ID=<profile> npx tsx scripts/fixture-test.ts`
Expected: 18 lines of `generated:` output (6 lexicon terms x 3 seeds), and a `manifest.json` with 18 entries each carrying a `seed`. Confirm two entries for the same term and different seeds have different file sizes — if they are identical, the seed is not reaching the service.

- [ ] **Step 4: Commit**

```bash
git add scripts/fixture-test.ts docs/fixture-test-procedure.md
git commit -m "feat: sample three fixed seeds per lexicon term in the fixture test"
```

---

## Self-Review Notes

**Spec coverage.** §1 (the problem) is the motivation, no task. §2 (seeding works) was verified before this plan existed; Task 3's echo guard and Task 4's reproducibility test keep it honest. §3 (derivation, override, immutable hash) -> Tasks 1 and 2, with the golden test carrying the immutability constraint. §4 (recording) -> Task 2's timing field and Task 4's recording step, including the narration-only clause. §5 (required parameter, echo assertion) -> Task 3. §6 (fixture test method) -> Task 5. §7 risks are properties to understand, not work: the one-time render shift is inherent, the hash-immutability risk is enforced by Task 1's golden test, and per-engine/per-profile scope and determinism-is-not-quality are documented rather than coded. §8 is out of scope throughout — no seed scoring, no audio caching, no seeds on bed or silence beats.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. The two `<profile>` placeholders in Tasks 4 and 5 are runtime arguments the operator supplies, not unwritten content.

**Type consistency.** `beatSeed(videoId, beatId): number` is defined in Task 1 and called with that exact signature in Task 4. `generate(spokenText, seed)` is defined in Task 3 and called that way in Tasks 4 and 5. `NarrationBeat.seed` and `TimingEntry.seed` are both `number | undefined` from Task 2 and consumed as such in Task 4. `HistoryResponse.seed` is `number | null | undefined`, and Task 3's guard handles all three.

**Ordering.** Tasks 1-3 are independent of each other and each ends green on `npm test` alone. Task 4 needs all three plus a live Voicebox. Task 5 needs Task 3. Task 4 is the only task whose test cannot run without a service.
