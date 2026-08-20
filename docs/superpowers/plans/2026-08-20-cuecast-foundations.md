# Cuecast Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build cuecast's first working slice — Mermaid diagram in, one hand-built example video rendered out — proving the timing-inversion mechanism and the Mermaid-as-diagram-source approach end to end, in a brand-new empty repo.

**Architecture:** A small TypeScript library (`src/`) with five independent modules — Mermaid→SVG rendering, the `video.json` schema, a narration-service HTTP client, timing extraction, and pronunciation-lexicon merging — composed by a Remotion video composition and a CLI orchestration script. Each library module is unit-tested in isolation with no live services required; the narration client and the full pipeline additionally get integration tests that require a running local TTS service, kept in separate directories and separate npm scripts so the fast default `npm test` never needs one running.

**Tech Stack:** Node.js ≥20, TypeScript 5, Vitest (unit tests), Zod (schema validation), Remotion 4 (`remotion`, `@remotion/cli`, `@remotion/renderer`) for composition and render, `@mermaid-js/mermaid-cli` (`mmdc`) for diagram rendering, `jsdom` for SVG DOM inspection, `execa` for shelling out to `mmdc`, native `fetch` for the narration HTTP client.

**Spec:** `docs/superpowers/specs/2026-08-20-cuecast-design.md` — this plan implements build-order steps 1–4 (§7 of the spec): the Mermaid-addressability spike, the `video.json` schema + narration round trip + pronunciation fixture test, the Remotion composition proof, and wiring generated timing into that composition end to end.

## Global Constraints

- No product content in this repo — example diagrams, scripts, and lexicon entries used for tests/spikes must be generic, not Vibrai- or any-other-product-specific (spec §8).
- `video.json`'s `text`/`spoken` split is required on every narration beat — never collapse them (spec §3, §5).
- No per-beat TTS engine override in the schema — one engine per video is a hard constraint (spec §5).
- `timing` is always a *generated* field in real usage; the one hand-written `timing` fixture in this plan (Task 8) is explicitly a test fixture standing in for generation, not a schema exception (spec §3, §7 step 3).
- Narration-service base URL and `profileId` are runtime config, never hardcoded into library code (spec §5).
- Synthetic-voice disclosure policy is out of scope for this repo — do not add a disclosure field or default copy anywhere in this plan (spec §5).

---

## Task 1: Repo scaffold and toolchain sanity check

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/sanity.ts`
- Test: `src/sanity.test.ts`

**Interfaces:**
- Produces: a working `npm install`, `npm run build`, `npm test` toolchain every later task depends on.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "cuecast",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc --noEmit",
    "test": "vitest run src",
    "test:integration": "vitest run test/integration",
    "test:render": "vitest run test/render",
    "test:all": "vitest run"
  },
  "dependencies": {
    "@mermaid-js/mermaid-cli": "^11.4.0",
    "@remotion/cli": "^4.0.0",
    "@remotion/renderer": "^4.0.0",
    "execa": "^9.4.0",
    "jsdom": "^25.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "remotion": "^4.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "jsx": "react-jsx",
    "outDir": "dist"
  },
  "include": ["src", "test", "remotion.config.ts"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
out/
generated/
*.mp4
.env
```

- [ ] **Step 5: Write the sanity module**

```ts
// src/sanity.ts
export function ping(): string {
  return "pong";
}
```

- [ ] **Step 6: Write the failing sanity test**

```ts
// src/sanity.test.ts
import { describe, expect, it } from "vitest";
import { ping } from "./sanity.js";

describe("toolchain sanity", () => {
  it("resolves TypeScript + Vitest end to end", () => {
    expect(ping()).toBe("pong");
  });
});
```

- [ ] **Step 7: Install dependencies and run the test**

Run: `npm install && npm test`
Expected: PASS — 1 test passed. If `npm install` fails on `@mermaid-js/mermaid-cli` (it pulls in Puppeteer/Chromium), note the failure and resolve platform prerequisites before continuing; every later task depends on this install succeeding.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/sanity.ts src/sanity.test.ts package-lock.json
git commit -m "chore: scaffold TypeScript + Vitest toolchain"
```

---

## Task 2: Mermaid → SVG render wrapper

**Files:**
- Create: `src/mermaid/renderMermaidToSvg.ts`
- Test: `src/mermaid/renderMermaidToSvg.test.ts`
- Create: `test/fixtures/generic-container.mmd`

**Interfaces:**
- Consumes: `execa` (Task 1 dependency), the `mmdc` binary installed by `@mermaid-js/mermaid-cli`.
- Produces:
  ```ts
  export interface RenderMermaidOptions {
    inputPath: string;
    outputDir: string;
  }
  export interface RenderMermaidResult {
    svgPath: string;
    svg: string;
  }
  export async function renderMermaidToSvg(
    options: RenderMermaidOptions
  ): Promise<RenderMermaidResult>;
  ```
  Task 3 and Task 8 both call `renderMermaidToSvg`.

- [ ] **Step 1: Write the generic test fixture diagram**

```
// test/fixtures/generic-container.mmd
C4Container
title Example System Container Diagram

Person(user, "User")
System_Boundary(sys, "Example System") {
  Container(api, "API", "Node.js", "Handles requests")
  ContainerDb(db, "Database", "Postgres", "Stores data")
}

Rel(user, api, "Uses", "HTTPS")
Rel(api, db, "Reads/writes", "SQL")
```

- [ ] **Step 2: Write the failing test**

```ts
// src/mermaid/renderMermaidToSvg.test.ts
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderMermaidToSvg } from "./renderMermaidToSvg.js";

describe("renderMermaidToSvg", () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), "cuecast-mermaid-"));
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  it("renders a C4Container diagram to an SVG file", async () => {
    const result = await renderMermaidToSvg({
      inputPath: "test/fixtures/generic-container.mmd",
      outputDir,
    });

    expect(existsSync(result.svgPath)).toBe(true);
    expect(result.svg).toContain("<svg");
  });
}, 30_000);
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- renderMermaidToSvg`
Expected: FAIL with "Cannot find module './renderMermaidToSvg.js'" (or equivalent — the module doesn't exist yet).

- [ ] **Step 4: Implement the wrapper**

```ts
// src/mermaid/renderMermaidToSvg.ts
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { execa } from "execa";

export interface RenderMermaidOptions {
  inputPath: string;
  outputDir: string;
}

export interface RenderMermaidResult {
  svgPath: string;
  svg: string;
}

export async function renderMermaidToSvg(
  options: RenderMermaidOptions
): Promise<RenderMermaidResult> {
  const outputName = basename(options.inputPath).replace(/\.mmd$/, ".svg");
  const svgPath = join(options.outputDir, outputName);

  await execa("npx", [
    "mmdc",
    "-i",
    options.inputPath,
    "-o",
    svgPath,
    "--puppeteerConfigFile",
    "-",
  ], {
    input: JSON.stringify({ args: ["--no-sandbox"] }),
  });

  const svg = readFileSync(svgPath, "utf-8");
  return { svgPath, svg };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- renderMermaidToSvg`
Expected: PASS. If `mmdc` fails with a sandbox/Chromium launch error, the `--puppeteerConfigFile` `--no-sandbox` flag above is the standard fix for CI/containerized environments — confirm it resolves the failure before treating this as a real bug.

- [ ] **Step 6: Commit**

```bash
git add src/mermaid/renderMermaidToSvg.ts src/mermaid/renderMermaidToSvg.test.ts test/fixtures/generic-container.mmd
git commit -m "feat: render Mermaid diagrams to SVG via mmdc"
```

---

## Task 3: Mermaid-addressability spike

This is the spec's top-priority open risk (§6): does Mermaid's rendered C4 SVG expose stable, selectable per-node and per-`Rel` IDs? The answer determines what `revealGroups` in the schema (Task 4) can actually key on.

**Files:**
- Create: `src/mermaid/inspectSvgIds.ts`
- Test: `src/mermaid/inspectSvgIds.test.ts`
- Create: `spikes/mermaid-addressability/README.md`

**Interfaces:**
- Consumes: `renderMermaidToSvg` (Task 2), `jsdom` (Task 1 dependency).
- Produces:
  ```ts
  export interface SvgElementId {
    tag: string;
    id: string;
    classes: string[];
  }
  export function inspectSvgIds(svgContent: string): SvgElementId[];
  ```
  Task 4's schema design and Task 8's Remotion composition both depend on this task's *findings* (documented in `spikes/mermaid-addressability/README.md`), not just the function.

- [ ] **Step 1: Write the failing test**

```ts
// src/mermaid/inspectSvgIds.test.ts
import { describe, expect, it } from "vitest";
import { inspectSvgIds } from "./inspectSvgIds.js";

describe("inspectSvgIds", () => {
  it("extracts every id'd element from an SVG document", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g id="person1" class="person"><rect /></g>
      <g id="rel-user-api" class="relationship"><line /></g>
      <g class="unlabeled"><rect /></g>
    </svg>`;

    const ids = inspectSvgIds(svg);

    expect(ids).toEqual([
      { tag: "g", id: "person1", classes: ["person"] },
      { tag: "g", id: "rel-user-api", classes: ["relationship"] },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- inspectSvgIds`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `inspectSvgIds`**

```ts
// src/mermaid/inspectSvgIds.ts
import { JSDOM } from "jsdom";

export interface SvgElementId {
  tag: string;
  id: string;
  classes: string[];
}

export function inspectSvgIds(svgContent: string): SvgElementId[] {
  const dom = new JSDOM(svgContent, { contentType: "image/svg+xml" });
  const elements = Array.from(
    dom.window.document.querySelectorAll("[id]")
  );

  return elements.map((el) => ({
    tag: el.tagName.toLowerCase(),
    id: el.getAttribute("id") ?? "",
    classes: el.getAttribute("class")?.split(/\s+/).filter(Boolean) ?? [],
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- inspectSvgIds`
Expected: PASS.

- [ ] **Step 5: Run the spike against the real rendered diagram**

This step has no fixed expected output — it's the investigation itself. Write and run a throwaway script (delete it after, don't commit it):

```ts
// scratch: run with `npx tsx scratch-inspect.ts`, then delete the file
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderMermaidToSvg } from "./src/mermaid/renderMermaidToSvg.js";
import { inspectSvgIds } from "./src/mermaid/inspectSvgIds.js";

const outputDir = mkdtempSync(join(tmpdir(), "cuecast-spike-"));
const { svg } = await renderMermaidToSvg({
  inputPath: "test/fixtures/generic-container.mmd",
  outputDir,
});
console.log(JSON.stringify(inspectSvgIds(svg), null, 2));
```

Read the output. You're checking specifically:
- Does every `Person`/`Container`/`ContainerDb` element get an `id` attribute derived from its Mermaid alias (e.g. `user`, `api`, `db`)?
- Does every `Rel(...)` line get its own addressable `id`, or only a shared group wrapper?
- Are these ids stable across two separate renders of the same unchanged `.mmd` file (run it twice, diff the output)?

- [ ] **Step 6: Write up the findings**

```markdown
<!-- spikes/mermaid-addressability/README.md -->
# Mermaid addressability spike — findings

Diagram used: `test/fixtures/generic-container.mmd` (generic C4Container, 1 person, 2 containers, 2 rels).

## What mmdc's C4 SVG output actually exposes

[Fill in from Step 5's real output: list the actual `id` values produced for
each Person/Container/ContainerDb/Rel element, and whether they map
predictably to the Mermaid alias used in the source (e.g. `Container(api, ...)`
producing an element addressable as `api`).]

## Stability

[Fill in: did re-running the render on the same source produce the same ids
both times? This determines whether `revealGroups` can be written once and
trusted not to silently break on a rebuild.]

## Consequence for the schema (Task 4)

[Fill in one of:
- "Individual node/Rel IDs are addressable and stable — `revealGroups` can
  key on Mermaid aliases directly, exactly as drafted in the design spec."
- "Only group-level wrappers are addressable — `revealGroups` must key on
  [whatever the actual wrapper granularity is], which means reveal
  granularity is per-[Container/Boundary/etc.], not per-individual-Rel."]
```

Fill in the two `[Fill in ...]` blocks with what Step 5 actually showed before moving on — Task 4's `revealGroups` type depends on this being a real finding, not a guess.

- [ ] **Step 7: Commit**

```bash
git add src/mermaid/inspectSvgIds.ts src/mermaid/inspectSvgIds.test.ts spikes/mermaid-addressability/README.md
git commit -m "spike: verify Mermaid C4 SVG element addressability"
```

---

## Task 4: `video.json` schema

**Files:**
- Create: `src/schema/videoScript.ts`
- Test: `src/schema/videoScript.test.ts`

**Interfaces:**
- Consumes: Task 3's findings (`spikes/mermaid-addressability/README.md`) to decide what `revealGroups`' values key on.
- Produces:
  ```ts
  export type BeatType = "narration" | "silence" | "bed";
  export interface NarrationBeat { id: string; type: "narration"; text: string; spoken: string; reveal?: string[]; }
  export interface SilenceBeat { id: string; type: "silence"; duration: number; }
  export interface BedBeat { id: string; type: "bed"; audio: string; duck?: string[]; }
  export type ScriptBeat = NarrationBeat | SilenceBeat | BedBeat;
  export interface TimingEntry { beatId: string; startSeconds: number; endSeconds: number; }
  export interface VideoScript {
    id: string;
    diagram: { source: string; revealGroups: Record<string, string[]>; };
    script: ScriptBeat[];
    pronunciations: Record<string, string>;
    timing: TimingEntry[];
  }
  export function parseVideoScript(json: unknown): VideoScript;
  ```
  Task 6 (`buildTimingTrack`), Task 8 (Remotion composition props), and Task 9 (end-to-end script) all import `VideoScript`, `ScriptBeat`, and `TimingEntry` from this module.

- [ ] **Step 1: Write the failing test**

```ts
// src/schema/videoScript.test.ts
import { describe, expect, it } from "vitest";
import { parseVideoScript } from "./videoScript.js";

const validScript = {
  id: "example_video",
  diagram: {
    source: "test/fixtures/generic-container.mmd",
    revealGroups: { group_api: ["api"], group_db: ["db"] },
  },
  script: [
    {
      id: "beat_01",
      type: "narration",
      text: "The API talks to the database.",
      spoken: "The A P I talks to the database.",
      reveal: ["group_api"],
    },
    { id: "beat_02", type: "silence", duration: 1.5 },
  ],
  pronunciations: { api: "A P I" },
  timing: [],
};

describe("parseVideoScript", () => {
  it("accepts a valid video script", () => {
    const parsed = parseVideoScript(validScript);
    expect(parsed.id).toBe("example_video");
    expect(parsed.script).toHaveLength(2);
  });

  it("rejects a narration beat missing the spoken field", () => {
    const invalid = {
      ...validScript,
      script: [
        { id: "beat_01", type: "narration", text: "no spoken field" },
      ],
    };
    expect(() => parseVideoScript(invalid)).toThrow();
  });

  it("rejects an unknown beat type", () => {
    const invalid = {
      ...validScript,
      script: [{ id: "beat_01", type: "explosion" }],
    };
    expect(() => parseVideoScript(invalid)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- videoScript`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the schema**

```ts
// src/schema/videoScript.ts
import { z } from "zod";

const narrationBeatSchema = z.object({
  id: z.string(),
  type: z.literal("narration"),
  text: z.string(),
  spoken: z.string(),
  reveal: z.array(z.string()).optional(),
});

const silenceBeatSchema = z.object({
  id: z.string(),
  type: z.literal("silence"),
  duration: z.number().positive(),
});

const bedBeatSchema = z.object({
  id: z.string(),
  type: z.literal("bed"),
  audio: z.string(),
  duck: z.array(z.string()).optional(),
});

const scriptBeatSchema = z.discriminatedUnion("type", [
  narrationBeatSchema,
  silenceBeatSchema,
  bedBeatSchema,
]);

const timingEntrySchema = z.object({
  beatId: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
});

const videoScriptSchema = z.object({
  id: z.string(),
  diagram: z.object({
    source: z.string(),
    revealGroups: z.record(z.array(z.string())),
  }),
  script: z.array(scriptBeatSchema),
  pronunciations: z.record(z.string()),
  timing: z.array(timingEntrySchema),
});

export type BeatType = "narration" | "silence" | "bed";
export type NarrationBeat = z.infer<typeof narrationBeatSchema>;
export type SilenceBeat = z.infer<typeof silenceBeatSchema>;
export type BedBeat = z.infer<typeof bedBeatSchema>;
export type ScriptBeat = z.infer<typeof scriptBeatSchema>;
export type TimingEntry = z.infer<typeof timingEntrySchema>;
export type VideoScript = z.infer<typeof videoScriptSchema>;

export function parseVideoScript(json: unknown): VideoScript {
  return videoScriptSchema.parse(json);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- videoScript`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/schema/videoScript.ts src/schema/videoScript.test.ts
git commit -m "feat: add video.json schema with narration/silence/bed beats"
```

---

## Task 5: Narration service HTTP client

**Files:**
- Create: `src/narration/narrationClient.ts`
- Test: `src/narration/narrationClient.test.ts`
- Test: `test/integration/narrationClient.integration.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure HTTP client), but accepts an injectable `fetch` implementation for testing.
- Produces:
  ```ts
  export interface NarrationClientConfig {
    baseUrl: string;
    profileId: string;
    fetchImpl?: typeof fetch;
  }
  export interface GenerateResult { audioPath: string; }
  export interface TranscribeWord { text: string; startSeconds: number; endSeconds: number; }
  export interface TranscribeSegment { text: string; startSeconds: number; endSeconds: number; words?: TranscribeWord[]; }
  export interface TranscribeResult { segments: TranscribeSegment[]; }
  export class NarrationClient {
    constructor(config: NarrationClientConfig);
    generate(spokenText: string): Promise<GenerateResult>;
    transcribe(audioPath: string): Promise<TranscribeResult>;
  }
  ```
  Task 6 (`buildTimingTrack`) and Task 9 (end-to-end script) both call `NarrationClient.generate` and `.transcribe`.

- [ ] **Step 1: Write the failing unit test (mocked fetch, no live service needed)**

```ts
// src/narration/narrationClient.test.ts
import { describe, expect, it, vi } from "vitest";
import { NarrationClient } from "./narrationClient.js";

describe("NarrationClient", () => {
  it("posts spoken text to /generate and returns the audio path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ audio_path: "/tmp/beat_01.wav" }),
    });

    const client = new NarrationClient({
      baseUrl: "http://127.0.0.1:17493",
      profileId: "test-profile",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.generate("hello world");

    expect(result.audioPath).toBe("/tmp/beat_01.wav");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:17493/generate",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("posts an audio path to /transcribe and returns segments", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        segments: [{ text: "hello world", start: 0.0, end: 1.2 }],
      }),
    });

    const client = new NarrationClient({
      baseUrl: "http://127.0.0.1:17493",
      profileId: "test-profile",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.transcribe("/tmp/beat_01.wav");

    expect(result.segments).toEqual([
      { text: "hello world", startSeconds: 0.0, endSeconds: 1.2, words: undefined },
    ]);
  });

  it("throws when the service responds with a non-ok status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const client = new NarrationClient({
      baseUrl: "http://127.0.0.1:17493",
      profileId: "test-profile",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.generate("hello")).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- narrationClient`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the client**

```ts
// src/narration/narrationClient.ts
export interface NarrationClientConfig {
  baseUrl: string;
  profileId: string;
  fetchImpl?: typeof fetch;
}

export interface GenerateResult {
  audioPath: string;
}

export interface TranscribeWord {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface TranscribeSegment {
  text: string;
  startSeconds: number;
  endSeconds: number;
  words?: TranscribeWord[];
}

export interface TranscribeResult {
  segments: TranscribeSegment[];
}

export class NarrationClient {
  private readonly baseUrl: string;
  private readonly profileId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: NarrationClientConfig) {
    this.baseUrl = config.baseUrl;
    this.profileId = config.profileId;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generate(spokenText: string): Promise<GenerateResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: spokenText, profile_id: this.profileId }),
    });

    if (!response.ok) {
      throw new Error(`narration /generate failed: HTTP ${response.status}`);
    }

    const body = (await response.json()) as { audio_path: string };
    return { audioPath: body.audio_path };
  }

  async transcribe(audioPath: string): Promise<TranscribeResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audio_path: audioPath }),
    });

    if (!response.ok) {
      throw new Error(`narration /transcribe failed: HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      segments: Array<{
        text: string;
        start: number;
        end: number;
        words?: Array<{ text: string; start: number; end: number }>;
      }>;
    };

    return {
      segments: body.segments.map((segment) => ({
        text: segment.text,
        startSeconds: segment.start,
        endSeconds: segment.end,
        words: segment.words?.map((word) => ({
          text: word.text,
          startSeconds: word.start,
          endSeconds: word.end,
        })),
      })),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- narrationClient`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Write the integration test that verifies real timestamp granularity**

This test requires a real local TTS service reachable at `CUECAST_TTS_URL` and resolves the spec's open question (§6): does `/transcribe` return word-level timestamps (a populated `words` array) or segment-level only (`words` undefined)?

```ts
// test/integration/narrationClient.integration.test.ts
import { describe, expect, it } from "vitest";
import { NarrationClient } from "../../src/narration/narrationClient.js";

const baseUrl = process.env.CUECAST_TTS_URL;

describe.skipIf(!baseUrl)("NarrationClient (live service)", () => {
  it("generates and transcribes a real phrase, and reports the timestamp granularity found", async () => {
    const client = new NarrationClient({
      baseUrl: baseUrl!,
      profileId: process.env.CUECAST_TTS_PROFILE_ID ?? "default",
    });

    const generated = await client.generate("This is a granularity check.");
    const transcribed = await client.transcribe(generated.audioPath);

    expect(transcribed.segments.length).toBeGreaterThan(0);

    const hasWordLevel = transcribed.segments.some(
      (segment) => segment.words && segment.words.length > 0
    );
    console.log(
      `[granularity finding] word-level timestamps present: ${hasWordLevel}`
    );
    console.log(JSON.stringify(transcribed, null, 2));
  });
}, 60_000);
```

- [ ] **Step 6: Run the integration test against a real service and record the finding**

Run: `CUECAST_TTS_URL=http://127.0.0.1:17493 CUECAST_TTS_PROFILE_ID=<your-profile> npm run test:integration`
Expected: PASS, with console output showing whether `words` is populated. Append the finding to `spikes/mermaid-addressability/README.md`'s sibling — create `spikes/narration-granularity/README.md` — with one line: "word-level" or "segment-level," and the raw JSON sample. This is the spec's own flagged open question (§6); Task 6's `buildTimingTrack` should stay correct either way, but this record is what tells a future task whether tighter emphasis sync (word-level) is available to build on.

```bash
mkdir -p spikes/narration-granularity
```

```markdown
<!-- spikes/narration-granularity/README.md -->
# Narration timestamp granularity — finding

[Fill in from Step 6's real run: "segment-level" or "word-level", plus the
raw JSON response for one real /transcribe call.]
```

- [ ] **Step 7: Commit**

```bash
git add src/narration/narrationClient.ts src/narration/narrationClient.test.ts test/integration/narrationClient.integration.test.ts spikes/narration-granularity/README.md
git commit -m "feat: add narration service HTTP client, verify transcribe granularity"
```

---

## Task 6: Timing extraction

**Files:**
- Create: `src/timing/timingExtractor.ts`
- Test: `src/timing/timingExtractor.test.ts`

**Interfaces:**
- Consumes: `TranscribeResult` (Task 5), `NarrationBeat`, `ScriptBeat`, `TimingEntry` (Task 4).
- Produces:
  ```ts
  export function extractBeatTiming(
    beat: NarrationBeat,
    transcribeResult: TranscribeResult,
    offsetSeconds: number
  ): TimingEntry;
  export function buildTimingTrack(
    beats: ScriptBeat[],
    transcriptions: Map<string, TranscribeResult>
  ): TimingEntry[];
  ```
  Task 9's end-to-end script calls `buildTimingTrack`.

- [ ] **Step 1: Write the failing test**

```ts
// src/timing/timingExtractor.test.ts
import { describe, expect, it } from "vitest";
import type { NarrationBeat, ScriptBeat } from "../schema/videoScript.js";
import type { TranscribeResult } from "../narration/narrationClient.js";
import { buildTimingTrack, extractBeatTiming } from "./timingExtractor.js";

const narrationBeat: NarrationBeat = {
  id: "beat_01",
  type: "narration",
  text: "The API talks to the database.",
  spoken: "The A P I talks to the database.",
};

describe("extractBeatTiming", () => {
  it("aligns on segment boundaries and applies the timeline offset", () => {
    const transcribeResult: TranscribeResult = {
      segments: [
        { text: "The A P I talks to the database.", startSeconds: 0, endSeconds: 2.4 },
      ],
    };

    const entry = extractBeatTiming(narrationBeat, transcribeResult, 5.0);

    expect(entry).toEqual({ beatId: "beat_01", startSeconds: 5.0, endSeconds: 7.4 });
  });
});

describe("buildTimingTrack", () => {
  it("lays out narration, silence, and bed beats sequentially on one timeline", () => {
    const beats: ScriptBeat[] = [
      narrationBeat,
      { id: "beat_02", type: "silence", duration: 1.5 },
      { id: "beat_03", type: "bed", audio: "clip.wav", duck: [] },
    ];

    const transcriptions = new Map<string, TranscribeResult>([
      [
        "beat_01",
        { segments: [{ text: "...", startSeconds: 0, endSeconds: 2.4 }] },
      ],
    ]);

    const timing = buildTimingTrack(beats, transcriptions);

    expect(timing).toEqual([
      { beatId: "beat_01", startSeconds: 0, endSeconds: 2.4 },
      { beatId: "beat_02", startSeconds: 2.4, endSeconds: 3.9 },
      { beatId: "beat_03", startSeconds: 3.9, endSeconds: 3.9 },
    ]);
  });

  it("throws if a narration beat has no matching transcription", () => {
    const beats: ScriptBeat[] = [narrationBeat];
    expect(() => buildTimingTrack(beats, new Map())).toThrow(/beat_01/);
  });
});
```

Note on the `beat_03` expectation: a `bed` beat's own duration comes from its audio asset's real length, which this module doesn't measure (that's a media-probing concern, not a timing-extraction one) — so it lays out as a zero-length marker at its start time. Task 9's orchestration script is responsible for probing bed-audio duration before final render if a bed beat needs to reserve real time on the timeline; that's out of scope for this task and not required for the one narration-only example video Task 9 builds.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- timingExtractor`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement timing extraction**

```ts
// src/timing/timingExtractor.ts
import type { NarrationBeat, ScriptBeat, TimingEntry } from "../schema/videoScript.js";
import type { TranscribeResult } from "../narration/narrationClient.js";

export function extractBeatTiming(
  beat: NarrationBeat,
  transcribeResult: TranscribeResult,
  offsetSeconds: number
): TimingEntry {
  const first = transcribeResult.segments.at(0);
  const last = transcribeResult.segments.at(-1);

  if (!first || !last) {
    throw new Error(`no transcription segments for beat ${beat.id}`);
  }

  return {
    beatId: beat.id,
    startSeconds: offsetSeconds + first.startSeconds,
    endSeconds: offsetSeconds + last.endSeconds,
  };
}

export function buildTimingTrack(
  beats: ScriptBeat[],
  transcriptions: Map<string, TranscribeResult>
): TimingEntry[] {
  const timing: TimingEntry[] = [];
  let cursorSeconds = 0;

  for (const beat of beats) {
    if (beat.type === "narration") {
      const transcribeResult = transcriptions.get(beat.id);
      if (!transcribeResult) {
        throw new Error(`missing transcription for narration beat ${beat.id}`);
      }
      const entry = extractBeatTiming(beat, transcribeResult, cursorSeconds);
      timing.push(entry);
      cursorSeconds = entry.endSeconds;
    } else if (beat.type === "silence") {
      const entry: TimingEntry = {
        beatId: beat.id,
        startSeconds: cursorSeconds,
        endSeconds: cursorSeconds + beat.duration,
      };
      timing.push(entry);
      cursorSeconds = entry.endSeconds;
    } else {
      timing.push({
        beatId: beat.id,
        startSeconds: cursorSeconds,
        endSeconds: cursorSeconds,
      });
    }
  }

  return timing;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- timingExtractor`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/timing/timingExtractor.ts src/timing/timingExtractor.test.ts
git commit -m "feat: extract sequential timing track from transcribed beats"
```

---

## Task 7: Pronunciation lexicon and fixture-test procedure

**Files:**
- Create: `src/pronunciation/lexicon.ts`
- Test: `src/pronunciation/lexicon.test.ts`
- Create: `lexicon/base.json`
- Create: `scripts/fixture-test.ts`
- Create: `docs/fixture-test-procedure.md`

**Interfaces:**
- Consumes: `NarrationClient` (Task 5).
- Produces:
  ```ts
  export type Lexicon = Record<string, string>;
  export function mergeLexicons(base: Lexicon, override: Lexicon): Lexicon;
  export function applyLexicon(text: string, lexicon: Lexicon): string;
  ```
  Task 9's end-to-end script calls `mergeLexicons` and `applyLexicon` to derive `spoken` fields where a product hasn't hand-overridden them.

- [ ] **Step 1: Write the failing test**

```ts
// src/pronunciation/lexicon.test.ts
import { describe, expect, it } from "vitest";
import { applyLexicon, mergeLexicons } from "./lexicon.js";

describe("mergeLexicons", () => {
  it("lets a product override entries take precedence over the base lexicon", () => {
    const base = { api: "A P I", cli: "C L I" };
    const override = { api: "ay pee eye" };

    expect(mergeLexicons(base, override)).toEqual({
      api: "ay pee eye",
      cli: "C L I",
    });
  });
});

describe("applyLexicon", () => {
  it("replaces whole-word matches case-insensitively", () => {
    const lexicon = { api: "A P I" };
    expect(applyLexicon("The API is fast.", lexicon)).toBe(
      "The A P I is fast."
    );
  });

  it("does not replace inside a longer word", () => {
    const lexicon = { cap: "kap" };
    expect(applyLexicon("Capital city.", lexicon)).toBe("Capital city.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lexicon`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the lexicon module**

```ts
// src/pronunciation/lexicon.ts
export type Lexicon = Record<string, string>;

export function mergeLexicons(base: Lexicon, override: Lexicon): Lexicon {
  return { ...base, ...override };
}

export function applyLexicon(text: string, lexicon: Lexicon): string {
  let result = text;
  for (const [term, respelling] of Object.entries(lexicon)) {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi");
    result = result.replace(pattern, respelling);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lexicon`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Write the shared base lexicon**

Only cross-product terms belong here (spec §5) — no product-specific coined names.

```json
// lexicon/base.json
{
  "api": "A P I",
  "cli": "C L I",
  "mcp": "em see pee",
  "json": "jay son",
  "url": "U R L"
}
```

- [ ] **Step 6: Write the fixture-test script**

This is a human-verification tool, not an automated pass/fail test (the spec is explicit that a person has to listen — §5). It generates one audio file per lexicon entry into a review folder.

```ts
// scripts/fixture-test.ts
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
```

- [ ] **Step 7: Write the fixture-test procedure doc**

```markdown
<!-- docs/fixture-test-procedure.md -->
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
```

- [ ] **Step 8: Commit**

```bash
git add src/pronunciation/lexicon.ts src/pronunciation/lexicon.test.ts lexicon/base.json scripts/fixture-test.ts docs/fixture-test-procedure.md
git commit -m "feat: add pronunciation lexicon merge and fixture-test procedure"
```

---

## Task 8: Remotion composition proof (hand-written timing fixture)

Proves the render leg in isolation, before wiring in generated timing (Task 9). Uses a hand-written `timing` block as a stand-in for generation — this is a deliberate test fixture, not a real usage pattern (Global Constraints).

**Files:**
- Create: `remotion.config.ts`
- Create: `src/remotion/Root.tsx`
- Create: `src/remotion/CuecastComposition.tsx`
- Create: `test/fixtures/render-proof-video.json`
- Test: `test/render/composition.render.test.ts`

**Interfaces:**
- Consumes: `renderMermaidToSvg` (Task 2), `VideoScript`/`parseVideoScript` (Task 4).
- Produces: a renderable Remotion composition named `"Cuecast"` taking props `{ videoScript: VideoScript; svgContent: string }`, registered via `src/remotion/Root.tsx`. Task 9's end-to-end script renders this same composition with generated (not hand-written) timing.

- [ ] **Step 1: Write the hand-written timing fixture**

Use the `revealGroups` keying scheme Task 3's spike actually found (fill in `["api"]`/`["db"]` below only if Task 3 confirmed individual-element addressability under those exact Mermaid aliases; otherwise substitute the wrapper-level ids Task 3 documented):

```json
// test/fixtures/render-proof-video.json
{
  "id": "render_proof",
  "diagram": {
    "source": "test/fixtures/generic-container.mmd",
    "revealGroups": { "group_api": ["api"], "group_db": ["db"] }
  },
  "script": [
    {
      "id": "beat_01",
      "type": "narration",
      "text": "The API talks to the database.",
      "spoken": "The A P I talks to the database.",
      "reveal": ["group_api"]
    },
    { "id": "beat_02", "type": "silence", "duration": 1.0 },
    {
      "id": "beat_03",
      "type": "narration",
      "text": "It reads and writes through SQL.",
      "spoken": "It reads and writes through S Q L.",
      "reveal": ["group_db"]
    }
  ],
  "pronunciations": { "sql": "S Q L", "api": "A P I" },
  "timing": [
    { "beatId": "beat_01", "startSeconds": 0.0, "endSeconds": 2.4 },
    { "beatId": "beat_02", "startSeconds": 2.4, "endSeconds": 3.4 },
    { "beatId": "beat_03", "startSeconds": 3.4, "endSeconds": 5.9 }
  ]
}
```

- [ ] **Step 2: Write `remotion.config.ts`**

```ts
// remotion.config.ts
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
```

- [ ] **Step 3: Write the composition**

```tsx
// src/remotion/CuecastComposition.tsx
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { VideoScript } from "../schema/videoScript.js";

export interface CuecastCompositionProps {
  videoScript: VideoScript;
  svgContent: string;
}

export const CuecastComposition: React.FC<CuecastCompositionProps> = ({
  videoScript,
  svgContent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSeconds = frame / fps;

  const visibleGroups = new Set<string>();
  for (const beat of videoScript.script) {
    if (beat.type !== "narration" || !beat.reveal) continue;
    const timing = videoScript.timing.find((t) => t.beatId === beat.id);
    if (timing && currentSeconds >= timing.startSeconds) {
      for (const group of beat.reveal) visibleGroups.add(group);
    }
  }

  const elementIds = new Set(
    Object.entries(videoScript.diagram.revealGroups)
      .filter(([group]) => visibleGroups.has(group))
      .flatMap(([, ids]) => ids)
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "white" }}>
      <div
        style={{ width: "100%", height: "100%" }}
        dangerouslySetInnerHTML={{
          __html: hideUnrevealedElements(svgContent, elementIds),
        }}
      />
    </AbsoluteFill>
  );
};

function hideUnrevealedElements(svg: string, visibleIds: Set<string>): string {
  const idPattern = /id="([^"]+)"/g;
  const allIds = new Set(
    Array.from(svg.matchAll(idPattern), (match) => match[1])
  );

  let result = svg;
  for (const id of allIds) {
    if (visibleIds.size > 0 && !visibleIds.has(id)) {
      result = result.replace(
        new RegExp(`(id="${id}"[^>]*)(>)`),
        `$1 style="opacity:0"$2`
      );
    }
  }
  return result;
}
```

- [ ] **Step 4: Write the Remotion root**

```tsx
// src/remotion/Root.tsx
import React from "react";
import { Composition, registerRoot } from "remotion";
import { CuecastComposition } from "./CuecastComposition.js";
import { parseVideoScript } from "../schema/videoScript.js";
import proofFixture from "../../test/fixtures/render-proof-video.json" with { type: "json" };
import { readFileSync } from "node:fs";

const videoScript = parseVideoScript(proofFixture);
const svgContent = readFileSync(
  "test/fixtures/render-proof-video.svg",
  "utf-8"
);

const RootComponent: React.FC = () => {
  const lastTiming = videoScript.timing.at(-1);
  const durationInSeconds = lastTiming?.endSeconds ?? 5;

  return (
    <Composition
      id="Cuecast"
      component={CuecastComposition}
      durationInFrames={Math.ceil(durationInSeconds * 30)}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ videoScript, svgContent }}
    />
  );
};

registerRoot(RootComponent);
```

Note: `Root.tsx` reads `test/fixtures/render-proof-video.svg`, a rendered file, not the `.mmd` source — Step 5 below generates it before the render test runs.

- [ ] **Step 5: Write the render smoke test**

```ts
// test/render/composition.render.test.ts
import { existsSync, statSync } from "node:fs";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { bundle } from "@remotion/bundler";
import { describe, expect, it } from "vitest";
import { renderMermaidToSvg } from "../../src/mermaid/renderMermaidToSvg.js";

describe("Cuecast composition render", () => {
  it("renders the hand-written fixture video end to end", async () => {
    await renderMermaidToSvg({
      inputPath: "test/fixtures/generic-container.mmd",
      outputDir: "test/fixtures",
    });
    // renderMermaidToSvg names its output after the input file's basename;
    // rename it to the filename Root.tsx expects.
    const { renameSync } = await import("node:fs");
    renameSync(
      "test/fixtures/generic-container.svg",
      "test/fixtures/render-proof-video.svg"
    );

    const bundleLocation = await bundle({
      entryPoint: "src/remotion/Root.tsx",
    });
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "Cuecast",
    });

    const outputLocation = "out/render-proof.mp4";
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation,
    });

    expect(existsSync(outputLocation)).toBe(true);
    expect(statSync(outputLocation).size).toBeGreaterThan(0);
  });
}, 120_000);
```

- [ ] **Step 6: Run the render test**

Run: `npm run test:render`
Expected: PASS — `out/render-proof.mp4` exists and is non-empty. If `bundle`/`renderMedia` fail on a missing Chromium/Remotion dependency, run `npx remotion browser ensure` first, then retry.

- [ ] **Step 7: Commit**

```bash
git add remotion.config.ts src/remotion/Root.tsx src/remotion/CuecastComposition.tsx test/fixtures/render-proof-video.json test/render/composition.render.test.ts
git commit -m "feat: prove Remotion composition renders reveals from a timing fixture"
```

---

## Task 9: End-to-end wiring — generated timing drives the real render

**Files:**
- Create: `scripts/render-video.ts`
- Create: `test/fixtures/example-video.json`
- Test: `test/integration/renderVideo.integration.test.ts`

**Interfaces:**
- Consumes: `parseVideoScript` (Task 4), `NarrationClient` (Task 5), `buildTimingTrack` (Task 6), `mergeLexicons`/`applyLexicon` (Task 7), `renderMermaidToSvg` (Task 2), the `"Cuecast"` composition (Task 8).
- Produces:
  ```ts
  export async function renderVideo(
    videoScriptPath: string,
    outputPath: string
  ): Promise<void>;
  ```
  This is the pipeline's first real orchestration entrypoint — the CLI wrapper the spec's build-order step 6 calls for wraps this function; that CLI is out of scope for this plan.

- [ ] **Step 1: Write the example video (no `timing` — generated at render time)**

```json
// test/fixtures/example-video.json
{
  "id": "example_video",
  "diagram": {
    "source": "test/fixtures/generic-container.mmd",
    "revealGroups": { "group_api": ["api"], "group_db": ["db"] }
  },
  "script": [
    {
      "id": "beat_01",
      "type": "narration",
      "text": "The API talks to the database.",
      "spoken": "The A P I talks to the database.",
      "reveal": ["group_api"]
    },
    { "id": "beat_02", "type": "silence", "duration": 1.0 },
    {
      "id": "beat_03",
      "type": "narration",
      "text": "It reads and writes through SQL.",
      "spoken": "It reads and writes through S Q L.",
      "reveal": ["group_db"]
    }
  ],
  "pronunciations": { "sql": "S Q L", "api": "A P I" },
  "timing": []
}
```

- [ ] **Step 2: Write the orchestration script**

```ts
// scripts/render-video.ts
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { renderMermaidToSvg } from "../src/mermaid/renderMermaidToSvg.js";
import { NarrationClient, type TranscribeResult } from "../src/narration/narrationClient.js";
import { buildTimingTrack } from "../src/timing/timingExtractor.js";
import { applyLexicon, mergeLexicons } from "../src/pronunciation/lexicon.js";
import { parseVideoScript, type VideoScript } from "../src/schema/videoScript.js";
import baseLexicon from "../lexicon/base.json" with { type: "json" };

export async function renderVideo(
  videoScriptPath: string,
  outputPath: string
): Promise<void> {
  const baseUrl = process.env.CUECAST_TTS_URL;
  const profileId = process.env.CUECAST_TTS_PROFILE_ID;
  if (!baseUrl || !profileId) {
    throw new Error(
      "Set CUECAST_TTS_URL and CUECAST_TTS_PROFILE_ID before rendering."
    );
  }

  const rawJson = JSON.parse(readFileSync(videoScriptPath, "utf-8"));
  const videoScript: VideoScript = parseVideoScript(rawJson);
  const lexicon = mergeLexicons(baseLexicon, videoScript.pronunciations);

  const client = new NarrationClient({ baseUrl, profileId });
  const transcriptions = new Map<string, TranscribeResult>();

  for (const beat of videoScript.script) {
    if (beat.type !== "narration") continue;
    const spoken = beat.spoken || applyLexicon(beat.text, lexicon);
    const generated = await client.generate(spoken);
    const transcribed = await client.transcribe(generated.audioPath);
    transcriptions.set(beat.id, transcribed);
  }

  const timing = buildTimingTrack(videoScript.script, transcriptions);
  const finalVideoScript: VideoScript = { ...videoScript, timing };

  const { svgPath } = await renderMermaidToSvg({
    inputPath: videoScript.diagram.source,
    outputDir: "generated",
  });
  const svgOutputPath = "generated/current-render.svg";
  renameSync(svgPath, svgOutputPath);
  const svgContent = readFileSync(svgOutputPath, "utf-8");

  writeFileSync(
    "generated/current-render-video.json",
    JSON.stringify(finalVideoScript, null, 2)
  );

  const bundleLocation = await bundle({ entryPoint: "src/remotion/Root.tsx" });
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "Cuecast",
  });

  await renderMedia({
    composition: {
      ...composition,
      durationInFrames: Math.ceil(
        (finalVideoScript.timing.at(-1)?.endSeconds ?? 5) * 30
      ),
    },
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputPath,
    inputProps: { videoScript: finalVideoScript, svgContent },
  });
}
```

- [ ] **Step 3: Write the integration test**

```ts
// test/integration/renderVideo.integration.test.ts
import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderVideo } from "../../scripts/render-video.js";

const baseUrl = process.env.CUECAST_TTS_URL;

describe.skipIf(!baseUrl)("renderVideo (live service, end to end)", () => {
  it("generates narration, extracts timing, and renders a real video", async () => {
    const outputPath = "out/example-video.mp4";
    await renderVideo("test/fixtures/example-video.json", outputPath);

    expect(existsSync(outputPath)).toBe(true);
    expect(statSync(outputPath).size).toBeGreaterThan(0);
  });
}, 180_000);
```

- [ ] **Step 4: Run the integration test against the real service**

Run: `CUECAST_TTS_URL=http://127.0.0.1:17493 CUECAST_TTS_PROFILE_ID=<your-profile> npm run test:integration`
Expected: PASS — `out/example-video.mp4` exists and is non-empty. Watch it: confirm the API/database reveal actually lands where beat_01/beat_03's narration says it should, not just that the file exists. This is the first real proof of the timing-inversion mechanism working end to end (spec §1) — a green test only proves a file got written; watching it is what proves the mechanism.

- [ ] **Step 5: Commit**

```bash
git add scripts/render-video.ts test/fixtures/example-video.json test/integration/renderVideo.integration.test.ts
git commit -m "feat: wire generated narration timing into the Remotion render end to end"
```

---

## Self-Review Notes

**Spec coverage:** §1 (timing inversion) → Task 9. §2 (Mermaid over bespoke schema) → Tasks 2, 3. §3 (schema) → Task 4. §4 (pipeline stages) → Tasks 2, 5, 8, 9 collectively cover diagram→SVG, narration, timing, compose+render. §5 (narration integration, pronunciation) → Tasks 5, 7. §6 (risks) → Task 3 (addressability spike) and Task 5 Step 5 (granularity spike) directly resolve the two flagged open risks; the auto-layout-vs-video-composition risk and the cross-product-lexicon-collision risk are both properties of later, per-product work and correctly have no task here. §7 (build order steps 1–4) → this plan's whole scope; steps 5–7 (silence/bed ducking primitive, CLI wrapper, pilot integration) are correctly out of scope per the plan's stated boundary. §8 (out of scope) → respected throughout: no Vibrai content, no capture, no publishing, no disclosure policy.

**Placeholder scan:** the two `[Fill in ...]` blocks in Task 3 Step 6 and Task 5 Step 6 are intentional — they're spike write-ups whose content is discovered by running the step, not knowable in advance. Every other step has concrete code or a concrete command.

**Type consistency:** `VideoScript`/`ScriptBeat`/`TimingEntry` (Task 4) are imported unchanged by Tasks 6, 8, 9. `NarrationClient`/`TranscribeResult` (Task 5) are imported unchanged by Tasks 6, 9. `renderMermaidToSvg`'s `RenderMermaidResult` (Task 2) is consumed identically by Tasks 3, 8, 9.
