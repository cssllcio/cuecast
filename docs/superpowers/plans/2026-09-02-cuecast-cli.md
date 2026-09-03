# CLI, Compile Step and Path Domains (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cuecast build video.json --out out.mp4` work from any directory, so a consuming product can call it from its own repo.

**Architecture:** The pipeline moves out of untested `scripts/` into `src/`, gains an options object, and stops writing to cwd-relative paths. Three path domains are kept apart: the Remotion entry point resolves against the package, the caller's script and output resolve against cwd, and every intermediate goes to a per-run work directory handed to Remotion as `bundle({ publicDir })`. A compile step emits `dist/`, and `bin` points at it.

**Tech Stack:** TypeScript 5 (strict), Vitest 2, Remotion 4, Node >= 20's built-in `node:util` `parseArgs`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-02-cuecast-ducking-cli-captions-design.md` — this plan implements **§4 only**. §2/§3 (ducking) shipped in PR #14; §5 (captions) gets its own plan.

## Global Constraints

- Node >= 20, TypeScript strict, Vitest 2, Remotion 4. **No new dependencies** — arg parsing uses `node:util`'s built-in `parseArgs`, matching the repo's habit of hand-rolling small things.
- `npm test` is `vitest run src`, so **anything under `scripts/` is untested**. That is the reason for the move, not a side effect: during PR #12's review, changing `beat.seed ?? beatSeed(...)` to `||` in `scripts/render-video.ts` passed the typecheck and all 73 tests while silently discarding an authored seed of `0`.
- `publicAudioPath`'s `audio/<videoId>/<beatId>` namespacing stays exactly as it is. The per-video work dir is an additional layer, not a replacement — PR #8 added that guard deliberately for traversal and collision.
- Unit tests must never require a running service, spawn a process, or `chdir`.

**One deliberate deviation from the spec.** §4's usage line shows `[--no-captions]`, but captions are Phase 3. A flag that no code reads is speculative generality, which this project treats as a defect — so `--no-captions` and the `captions` field of the options object are **not** implemented here. Phase 3 adds both.

**Verified before this plan was written**, so no task needs to discover it:
- `tsc` emits cleanly from this config (`moduleResolution: "Bundler"` and the `?raw` SVG import are both fine) — trial run exited 0.
- `bundle()` accepts `publicDir` (`@remotion/bundler/dist/bundle.d.ts:15`), and resolves a relative one against the Remotion root (`bundle.js:257`), so it must be passed **absolute**.
- `renderVideo` has exactly one importer: `test/integration/renderVideo.integration.test.ts:4`. Seven other files mention `scripts/render-video.ts` in comments only.
- `test/fixtures/generic-container.mmd` sits beside the fixtures, so a script-relative `diagram.source` becomes just `"generic-container.mmd"`.

## File Structure

| File | Responsibility |
|---|---|
| `src/paths.ts` (create) | The three domains. Must stay at the top level of `src/` — see Task 1. |
| `src/pipeline/renderVideo.ts` (create, from `scripts/render-video.ts`) | The orchestration, now testable and directory-independent. |
| `src/cli/parseArgs.ts` (create) | Pure arg parsing. No `process.cwd()`, no I/O. |
| `src/cli/cuecast.ts` (create) | The executable: resolve, run, map errors to exit codes. |
| `tsconfig.build.json` (create) | Emit config: `src` only, no tests. |
| `package.json`, `.gitignore`, `README.md` (modify) | Packaging and docs. |
| `src/remotion/Root.tsx` (modify) | Stop importing test fixtures at module scope. |

---

## Task 1: The three path domains

**Files:**
- Create: `src/paths.ts`
- Test: `src/paths.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `packageRoot(): string`, `remotionEntryPoint(): string`, `resolveWorkDir(videoId: string, override?: string): string` — all absolute. Used by Tasks 3 and 4.

- [ ] **Step 1: Write the failing test**

```ts
// src/paths.test.ts
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { packageRoot, remotionEntryPoint, resolveWorkDir } from "./paths.js";

describe("packageRoot", () => {
  it("points at the directory holding package.json", () => {
    expect(existsSync(join(packageRoot(), "package.json"))).toBe(true);
  });

  it("is absolute", () => {
    expect(isAbsolute(packageRoot())).toBe(true);
  });
});

describe("remotionEntryPoint", () => {
  // Remotion bundles from TSX source, not from dist, which is why `src` ships
  // in the package's files list.
  it("points at a file that exists", () => {
    expect(existsSync(remotionEntryPoint())).toBe(true);
    expect(remotionEntryPoint().endsWith("src/remotion/Root.tsx")).toBe(true);
  });
});

describe("resolveWorkDir", () => {
  it("defaults to .cuecast/<videoId> under the caller's cwd", () => {
    expect(resolveWorkDir("example_video")).toBe(
      join(process.cwd(), ".cuecast", "example_video")
    );
  });

  it("resolves an override against the caller's cwd", () => {
    expect(resolveWorkDir("example_video", "tmp/run")).toBe(
      join(process.cwd(), "tmp", "run")
    );
  });

  it("leaves an absolute override alone", () => {
    expect(resolveWorkDir("example_video", "/tmp/run")).toBe("/tmp/run");
  });

  // The work dir belongs to the caller, not the package — that is the whole
  // point of the split. A run from another repo must not write here.
  it("does not put the work dir inside the package", () => {
    expect(resolveWorkDir("example_video").startsWith(packageRoot())).toBe(
      process.cwd().startsWith(packageRoot())
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/paths.test.ts`
Expected: FAIL — cannot find module `./paths.js`.

- [ ] **Step 3: Implement**

```ts
// src/paths.ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The package's own root.
 *
 * This file MUST stay at the top level of `src/`. The build emits `src/` to
 * `dist/` with `rootDir: "src"`, so this module lands at the top level of
 * `dist/` too — one level up is the package root both when running from
 * source under vitest and when running from the compiled bin. Move it into a
 * subdirectory and that stops being true in one of the two cases, silently.
 */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * What Remotion bundles. Resolved against the package, never the caller: a
 * consuming product runs `cuecast` from its own repo, where `src/remotion/`
 * does not exist. Remotion bundles TSX source rather than compiled output —
 * that is the supported path for its toolchain, and it is why `src` is in the
 * package's `files`.
 */
export function remotionEntryPoint(): string {
  return resolve(packageRoot(), "src", "remotion", "Root.tsx");
}

/**
 * Where a run's intermediates go: generated narration, copied audio, the
 * rendered SVG, the resolved script. Resolved against the CALLER's cwd, so a
 * run from another repo leaves its scratch there and never writes inside this
 * package (or, worse, inside somebody's node_modules).
 */
export function resolveWorkDir(videoId: string, override?: string): string {
  if (override !== undefined) {
    return resolve(process.cwd(), override);
  }
  return resolve(process.cwd(), ".cuecast", videoId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/paths.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/paths.ts src/paths.test.ts
git commit -m "feat: resolve the package, caller and work-dir path domains"
```

---

## Task 2: Move the pipeline into `src/`

This task is a relocation and a signature change, nothing more. Behaviour stays identical; Task 3 changes where files land.

**Files:**
- Create: `src/pipeline/renderVideo.ts` (moved from `scripts/render-video.ts`)
- Delete: `scripts/render-video.ts`
- Modify: `test/integration/renderVideo.integration.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 yet.
- Produces:
  ```ts
  export interface RenderVideoOptions {
    scriptPath: string;  // absolute
    outPath: string;     // absolute
    workDir: string;     // absolute
  }
  export async function renderVideo(options: RenderVideoOptions): Promise<void>;
  ```
  Task 4's CLI calls this.

- [ ] **Step 1: Move the file with git so history follows it**

```bash
mkdir -p src/pipeline
git mv scripts/render-video.ts src/pipeline/renderVideo.ts
```

- [ ] **Step 2: Fix its imports**

Every relative import in that file starts `../src/` and must become `../`, because the file moved from `scripts/` to `src/pipeline/`. The `lexicon/base.json` import goes up two instead of one. Replace the whole import block at the top of `src/pipeline/renderVideo.ts` with:

```ts
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { renderMermaidToSvg } from "../mermaid/renderMermaidToSvg.js";
import { NarrationClient } from "../narration/narrationClient.js";
import { resolveBeatSeed } from "../narration/beatSeed.js";
import {
  buildTimingTrack,
  decorateTimingTrack,
  describeBedClamps,
} from "../timing/timingExtractor.js";
import { mergeLexicons } from "../pronunciation/lexicon.js";
import { spokenForBeat } from "../pronunciation/spokenForBeat.js";
import { parseVideoScript, type VideoScript } from "../schema/videoScript.js";
import { cuecastWebpackOverride } from "../remotion/webpackOverride.js";
import { publicAudioPath } from "../audio/publicAudioPath.js";
import { probeAudioDurationSeconds } from "../audio/probeAudioDuration.js";
import { secondsToDurationFrames } from "../timing/frames.js";
import { timelineDurationSeconds } from "../timing/timelineDuration.js";
import baseLexicon from "../../lexicon/base.json" with { type: "json" };
```

- [ ] **Step 3: Change the signature to an options object**

Replace the function's opening lines:

```ts
export interface RenderVideoOptions {
  /** Absolute path to the video.json. */
  scriptPath: string;
  /** Absolute path to write the rendered mp4 to. */
  outPath: string;
  /** Absolute directory for this run's intermediates. */
  workDir: string;
}

export async function renderVideo(options: RenderVideoOptions): Promise<void> {
  const { scriptPath, outPath, workDir } = options;
```

Then, inside the body, rename the two old parameter references: `videoScriptPath` becomes `scriptPath` (one use, in the `readFileSync` on the next few lines) and `outputPath` becomes `outPath` (one use, `outputLocation:` near the end). `workDir` is unused until Task 3 — prefix it in the destructure as `workDir` and add `void workDir;` immediately after the destructure with the comment `// Used from Task 3 onward; destructured here so the options contract is complete.` so the strict compiler does not complain.

- [ ] **Step 4: Update the one importer**

In `test/integration/renderVideo.integration.test.ts`, change the import and both call sites. The import becomes:

```ts
import { renderVideo } from "../../src/pipeline/renderVideo.js";
```

Each call becomes an options object with absolute paths, e.g.:

```ts
    await renderVideo({
      scriptPath: resolve("test/fixtures/example-video.json"),
      outPath: resolve(outputPath),
      workDir: resolve(".cuecast/example_video"),
    });
```

Add `resolve` to the file's `node:path` imports (adding the import line if the file has none).

- [ ] **Step 5: Update the stale comments**

Seven files refer to `scripts/render-video.ts` in comments. Update each to `src/pipeline/renderVideo.ts`:
`src/narration/beatSeed.ts`, `src/timing/timelineDuration.ts`, `src/timing/timingExtractor.ts`, `src/audio/probeAudioDuration.ts`, `src/remotion/webpackOverride.ts`, `src/remotion/CuecastComposition.tsx`, `src/remotion/CuecastComposition.test.ts`, and `test/render/audioMux.render.test.ts`.

In `src/narration/beatSeed.ts` and `src/timing/timingExtractor.ts` the comment also says the file is untested because `scripts/` is not covered. That is no longer true after this move — reword those two to say the logic was extracted to be unit-testable, without the stale claim about `scripts/`.

- [ ] **Step 6: Verify**

Run: `npm test && npm run build`
Expected: PASS and clean. The unit count should rise, because `src/pipeline/renderVideo.ts` is now inside `vitest run src`'s scope even though it has no test of its own yet.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: move the render pipeline into src/ behind an options object"
```

---

## Task 3: Send every intermediate to the work directory

**Files:**
- Modify: `src/pipeline/renderVideo.ts`
- Modify: `test/fixtures/example-video.json`, `test/fixtures/render-proof-video.json`, `test/fixtures/duck-proof-video.json`

**Interfaces:**
- Consumes: `packageRoot`, `remotionEntryPoint`, `resolveWorkDir` (Task 1); `RenderVideoOptions` (Task 2).
- Produces: a `renderVideo` that writes nothing outside `workDir` and `outPath`.

- [ ] **Step 1: Make `diagram.source` relative to the script file**

All three fixtures say `"source": "test/fixtures/generic-container.mmd"`, which only resolves from the repo root. The `.mmd` sits beside them, so in each of the three files change that line to:

```json
    "source": "generic-container.mmd",
```

Only `example-video.json` is functionally affected — it is the one that goes through `renderVideo`. The other two are changed for consistency, because a future author copying one as a template would otherwise inherit a path that no longer resolves.

- [ ] **Step 2: Rewrite the path handling**

In `src/pipeline/renderVideo.ts`, add to the imports:

```ts
import { join, resolve } from "node:path";
import { remotionEntryPoint } from "../paths.js";
```

(`dirname` is already imported; extend the existing `node:path` line rather than adding a second one.)

Remove the `void workDir;` line from Task 2. Then replace each cwd-relative path with a work-dir one:

The audio copy helper's destination:

```ts
  const publicDir = join(workDir, "public");

  function copyBeatAudioToPublic(beatId: string, sourcePath: string): string {
    const publicPath = publicAudioPath(videoScript.id, beatId, sourcePath);
    const destination = join(publicDir, publicPath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(sourcePath, destination);
    return publicPath;
  }
```

The narration client's output directory:

```ts
    audioOutputDir: join(workDir, "narration"),
```

A bed beat's `audio` is authored in the script, so resolve it against the script file too — change the bed branch of the beat loop:

```ts
    } else if (beat.type === "bed") {
      const bedAudioPath = resolve(dirname(scriptPath), beat.audio);
      durations.set(beat.id, await probeAudioDurationSeconds(bedAudioPath));
      audioPaths.set(beat.id, copyBeatAudioToPublic(beat.id, bedAudioPath));
    }
```

The diagram render and the resolved-script dump:

```ts
  mkdirSync(workDir, { recursive: true });

  const { svgPath } = await renderMermaidToSvg({
    inputPath: resolve(dirname(scriptPath), videoScript.diagram.source),
    outputDir: workDir,
  });
  const svgOutputPath = join(workDir, "diagram.svg");
  renameSync(svgPath, svgOutputPath);
  const svgContent = readFileSync(svgOutputPath, "utf-8");

  writeFileSync(
    join(workDir, "resolved-video.json"),
    JSON.stringify(finalVideoScript, null, 2)
  );
```

The bundle call — `publicDir` must be absolute, because Remotion resolves a relative one against its own root rather than the caller's cwd:

```ts
  const bundleLocation = await bundle({
    entryPoint: remotionEntryPoint(),
    webpackOverride: cuecastWebpackOverride,
    publicDir,
  });
```

And make sure the output directory exists before rendering, since `--out` may name a directory that does not exist yet — add immediately before the `renderMedia` call:

```ts
  mkdirSync(dirname(outPath), { recursive: true });
```

- [ ] **Step 3: Verify nothing writes outside the work dir**

Run the render suite and the integration suite, then check the repo is clean of the old scratch paths:

```bash
npm run test:render
CUECAST_TTS_URL=http://127.0.0.1:17493 CUECAST_TTS_PROFILE_ID=<profile> npx vitest run test/integration --no-file-parallelism
git status --porcelain --ignored | grep -E "^!! (generated|public)/" || echo "no generated/ or public/ written"
```

Expected: both suites pass, and the final check prints `no generated/ or public/ written`. Those two directories were where the pipeline used to scatter its intermediates; if either reappears, a path was missed.

`--no-file-parallelism` is required: two integration files generating concurrently wedged a local Voicebox on 2026-09-02 and it needed a manual restart.

- [ ] **Step 4: Add `.cuecast/` to `.gitignore`**

Add a line `.cuecast/` to `.gitignore`, beside the existing `generated/` and `out/` entries.

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run build`
Expected: PASS and clean.

```bash
git add -A
git commit -m "feat: write every intermediate to a per-run work directory"
```

---

## Task 4: The CLI

**Files:**
- Create: `src/cli/parseArgs.ts`
- Create: `src/cli/cuecast.ts`
- Test: `src/cli/parseArgs.test.ts`

**Interfaces:**
- Consumes: `resolveWorkDir` (Task 1), `renderVideo` / `RenderVideoOptions` (Tasks 2-3).
- Produces: `parseCliArgs(argv: string[]): CliCommand` and the `CliUsageError` class. Task 5 invokes the compiled entry point.

- [ ] **Step 1: Write the failing test**

```ts
// src/cli/parseArgs.test.ts
import { describe, expect, it } from "vitest";
import { CliUsageError, parseCliArgs } from "./parseArgs.js";

describe("parseCliArgs", () => {
  it("parses a build command", () => {
    expect(parseCliArgs(["build", "video.json", "--out", "out.mp4"])).toEqual({
      command: "build",
      scriptPath: "video.json",
      outPath: "out.mp4",
      workDir: undefined,
    });
  });

  it("accepts a work-dir override", () => {
    expect(
      parseCliArgs(["build", "v.json", "--out", "o.mp4", "--work-dir", "tmp"])
    ).toMatchObject({ workDir: "tmp" });
  });

  it("recognises help and version before anything else", () => {
    expect(parseCliArgs(["--help"])).toEqual({ command: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ command: "help" });
    expect(parseCliArgs(["--version"])).toEqual({ command: "version" });
  });

  it("rejects no command at all", () => {
    expect(() => parseCliArgs([])).toThrow(CliUsageError);
  });

  it("rejects an unknown command, naming it", () => {
    expect(() => parseCliArgs(["render", "v.json"])).toThrow(/render/);
  });

  it("rejects a build with no script path", () => {
    expect(() => parseCliArgs(["build", "--out", "o.mp4"])).toThrow(/video\.json/);
  });

  it("rejects a build with no --out", () => {
    expect(() => parseCliArgs(["build", "v.json"])).toThrow(/--out/);
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(() => parseCliArgs(["build", "v.json", "--out", "o.mp4", "--wat"])).toThrow(
      CliUsageError
    );
  });

  it("rejects a stray extra positional", () => {
    expect(() =>
      parseCliArgs(["build", "v.json", "extra", "--out", "o.mp4"])
    ).toThrow(/extra/);
  });

  // Purity: the parser must not consult the filesystem or the cwd, so it can
  // be tested without chdir and so resolution stays the entry point's job.
  it("returns paths exactly as given, unresolved", () => {
    expect(parseCliArgs(["build", "./a/../b.json", "--out", "o.mp4"])).toMatchObject({
      scriptPath: "./a/../b.json",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/parseArgs.test.ts`
Expected: FAIL — cannot find module `./parseArgs.js`.

- [ ] **Step 3: Implement the parser**

```ts
// src/cli/parseArgs.ts
import { parseArgs } from "node:util";

export interface BuildCommand {
  command: "build";
  /** Exactly as the user typed it — the entry point resolves it. */
  scriptPath: string;
  outPath: string;
  workDir: string | undefined;
}

export type CliCommand = BuildCommand | { command: "help" } | { command: "version" };

/** A mistake in how the command was typed, as opposed to a failure while running it. */
export class CliUsageError extends Error {}

/**
 * Pure: no filesystem access, no `process.cwd()`, no `process.exit`. That is
 * what lets the CLI's behaviour be covered by the fast unit suite without
 * spawning anything, and it keeps path resolution in one place (the entry
 * point) rather than smeared across both.
 */
export function parseCliArgs(argv: string[]): CliCommand {
  // Checked before subcommand parsing so `cuecast --help` works with no
  // command, which is what a user reaching for help has.
  if (argv.includes("--help") || argv.includes("-h")) return { command: "help" };
  if (argv.includes("--version")) return { command: "version" };

  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    throw new CliUsageError("no command given; try `cuecast --help`");
  }
  if (subcommand !== "build") {
    throw new CliUsageError(`unknown command "${subcommand}"; try \`cuecast --help\``);
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      strict: true,
      options: {
        out: { type: "string" },
        "work-dir": { type: "string" },
      },
    });
  } catch (error) {
    // strict:true rejects unknown flags — surface that as usage, not a crash.
    throw new CliUsageError((error as Error).message);
  }

  const [scriptPath, ...extra] = parsed.positionals;
  if (scriptPath === undefined) {
    throw new CliUsageError("build needs a path to a video.json");
  }
  if (extra.length > 0) {
    throw new CliUsageError(`unexpected argument "${extra[0]}"`);
  }
  const outPath = parsed.values.out;
  if (outPath === undefined) {
    throw new CliUsageError("build needs --out <file.mp4>");
  }

  return {
    command: "build",
    scriptPath,
    outPath,
    workDir: parsed.values["work-dir"],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/parseArgs.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Write the entry point**

```ts
// src/cli/cuecast.ts
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CliUsageError, parseCliArgs } from "./parseArgs.js";
import { packageRoot, resolveWorkDir } from "../paths.js";
import { renderVideo } from "../pipeline/renderVideo.js";
import { parseVideoScript } from "../schema/videoScript.js";

const USAGE = `cuecast — narration-timed reveal animations

Usage:
  cuecast build <video.json> --out <out.mp4> [--work-dir <dir>]
  cuecast --help
  cuecast --version

Options:
  --out <file>       Where to write the rendered video. Required.
  --work-dir <dir>   Where to put this run's intermediates.
                     Defaults to .cuecast/<video id> under the current directory.

Environment:
  CUECAST_TTS_URL          Base URL of a running Voicebox instance.
  CUECAST_TTS_PROFILE_ID   Voice profile to generate narration with.
`;

function version(): string {
  const manifest = JSON.parse(
    readFileSync(join(packageRoot(), "package.json"), "utf-8")
  ) as { version: string };
  return manifest.version;
}

async function main(argv: string[]): Promise<number> {
  let command;
  try {
    command = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      process.stderr.write(`cuecast: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  if (command.command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command.command === "version") {
    process.stdout.write(`${version()}\n`);
    return 0;
  }

  const scriptPath = resolve(process.cwd(), command.scriptPath);
  const outPath = resolve(process.cwd(), command.outPath);

  // Parsed here as well as inside renderVideo, deliberately: the work dir's
  // default is named after the video id, and reading the script now means a
  // malformed one fails immediately with a clear message rather than after
  // the first TTS round trip.
  let videoId: string;
  try {
    videoId = parseVideoScript(JSON.parse(readFileSync(scriptPath, "utf-8"))).id;
  } catch (error) {
    process.stderr.write(`cuecast: ${scriptPath}: ${(error as Error).message}\n`);
    return 1;
  }

  if (!process.env.CUECAST_TTS_URL || !process.env.CUECAST_TTS_PROFILE_ID) {
    process.stderr.write(
      "cuecast: set CUECAST_TTS_URL and CUECAST_TTS_PROFILE_ID — both are required to generate narration\n"
    );
    return 1;
  }

  await renderVideo({
    scriptPath,
    outPath,
    workDir: resolveWorkDir(videoId, command.workDir),
  });
  process.stdout.write(`${outPath}\n`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
```

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run build`
Expected: PASS and clean.

```bash
git add src/cli/parseArgs.ts src/cli/parseArgs.test.ts src/cli/cuecast.ts
git commit -m "feat: add the cuecast build CLI"
```

---

## Task 5: Ship it — compile step, bin, and a package that does not reference `test/`

**Files:**
- Create: `tsconfig.build.json`
- Modify: `package.json`, `.gitignore`, `README.md`
- Modify: `src/remotion/Root.tsx`
- Modify: `test/integration/renderVideo.integration.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `dist/cli/cuecast.js` as the package's `bin`.

- [ ] **Step 1: Stop `Root.tsx` importing test fixtures**

`src/remotion/Root.tsx` imports two things from `test/` at module scope: the script JSON, and a 26KB SVG through the `?raw` rule. `test/` does not ship, so a published package's bundle breaks on both. Inlining the JSON is reasonable; inlining the SVG is not.

Both exist only so the composition is *selectable*. Every real render passes `inputProps` — and has had to since PR #3, which made passing them to `selectComposition` mandatory. So the defaults only need to be structurally valid, not renderable.

Replace the two fixture imports and the `videoScript`/`svgContent` bindings with a minimal in-`src` default:

```tsx
// A structurally-valid placeholder, not something anyone watches. Every real
// render passes inputProps — mandatory since PR #3 — so these defaults exist
// only to make the composition selectable. They deliberately do NOT import
// from test/, which does not ship: a published package's bundle must not
// reference fixtures.
const videoScript = parseVideoScript({
  id: "cuecast_default",
  diagram: { source: "diagram.mmd", revealGroups: {} },
  script: [],
  pronunciations: {},
  timing: [],
});
const svgContent = "";
```

Delete the now-unused `proofFixture` and `?raw` import lines. Keep the `parseVideoScript` import.

- [ ] **Step 2: Verify the render suite still passes**

Run: `npm run test:render`
Expected: PASS, 3/3. These tests pass `inputProps` explicitly, so removing the defaults must not affect them — that is the claim being checked.

- [ ] **Step 3: Add the emit config**

```json
// tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]
}
```

`rootDir: "src"` is what makes `src/cli/cuecast.ts` emit to `dist/cli/cuecast.js` rather than `dist/src/cli/cuecast.js` — the `bin` path below depends on it.

- [ ] **Step 4: Wire up the package**

In `package.json`: change `"build"` to the emit, add `"typecheck"` for what `build` used to do, and add `bin` and `files`.

```json
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run src",
    "test:integration": "vitest run test/integration",
    "test:render": "vitest run test/render",
    "test:all": "vitest run"
  },
  "bin": { "cuecast": "dist/cli/cuecast.js" },
  "files": ["dist", "src", "lexicon"],
```

`src` ships because Remotion bundles the composition from TSX source. `lexicon` ships because `renderVideo` imports `lexicon/base.json` at runtime.

Add `dist/` to `.gitignore`.

- [ ] **Step 5: Verify the build produces a runnable bin**

```bash
npm run build
test -f dist/cli/cuecast.js && echo "bin emitted"
node dist/cli/cuecast.js --version
node dist/cli/cuecast.js --help
node dist/cli/cuecast.js build 2>&1; echo "exit=$?"
```

Expected: `bin emitted`; the version prints `0.1.0`; help prints the usage block and exits 0; the last one prints `cuecast: build needs a path to a video.json` and exits 1.

- [ ] **Step 6: Run the integration suite through the built binary**

The compile step is new, so testing `renderVideo` as a function would leave the shipped artifact unexercised. In `test/integration/renderVideo.integration.test.ts`, add this test inside the existing `describe.skipIf(!baseUrl)` block:

```ts
  // Exercises what actually ships. Testing renderVideo() directly would leave
  // the compiled bin — the only thing a consuming product runs — unverified.
  it("renders through the built binary, from a directory outside the repo", async () => {
    await execa("npm", ["run", "build"], { cwd: packageRoot() });

    const cwd = mkdtempSync(join(tmpdir(), "cuecast-cli-"));
    const outPath = join(cwd, "cli-render.mp4");

    await execa(
      "node",
      [
        join(packageRoot(), "dist/cli/cuecast.js"),
        "build",
        join(packageRoot(), "test/fixtures/example-video.json"),
        "--out",
        outPath,
      ],
      { cwd, env: process.env }
    );

    expect(existsSync(outPath)).toBe(true);
    // The work dir belongs to the caller's directory, not the package.
    expect(existsSync(join(cwd, ".cuecast", "example_video"))).toBe(true);
    expect(existsSync(join(packageRoot(), "generated"))).toBe(false);

    rmSync(cwd, { recursive: true, force: true });
  }, 600_000);
```

Add the imports this needs to that file: `mkdtempSync`, `rmSync`, `existsSync` from `node:fs`; `tmpdir` from `node:os`; `join` from `node:path`; and `packageRoot` from `../../src/paths.js`. `execa` is already imported.

- [ ] **Step 7: Run it**

Run: `CUECAST_TTS_URL=http://127.0.0.1:17493 CUECAST_TTS_PROFILE_ID=<profile> npx vitest run test/integration --no-file-parallelism`
Expected: PASS. This is the first proof that a run from outside the repo works — the thing the whole phase exists for.

- [ ] **Step 8: Update the README**

Replace the status sentence "There is no CLI yet; the entry point is `renderVideo()` in [`scripts/render-video.ts`](scripts/render-video.ts)." with:

```markdown
The entry point is the `cuecast` CLI:

```bash
npm run build
node dist/cli/cuecast.js build video.json --out out.mp4
```

It runs from any directory. The `video.json` path and `--out` resolve against
wherever you invoke it, a script's `diagram.source` and a bed beat's `audio`
resolve against the script file, and every intermediate goes to
`.cuecast/<video id>/` beside you — never inside the package.
```

Also update the Layout block: `scripts/` no longer holds `render-video.ts`, and there are two new entries. Change those lines to:

```
src/cli/           the cuecast binary and its arg parsing
src/pipeline/      renderVideo — the orchestration
scripts/           fixture-test.ts (listen test)
```

- [ ] **Step 9: Full verification and commit**

```bash
npm test && npm run typecheck && npm run build && npm run test:render
```
Expected: all green.

```bash
git add -A
git commit -m "feat: compile to dist and ship a cuecast bin"
```

---

## Self-Review Notes

**Spec coverage.** §4's compile-step decision → Task 5 (`tsconfig.build.json`, `build`/`typecheck` split, `bin`, `files`). Its second argument — that `scripts/` is entirely untested — → Task 2, which is the move that closes it. `node:util` `parseArgs` and the pure-function requirement → Task 4. The usage string → Task 4's `USAGE`, minus `--no-captions`, which is called out at the top of this plan as a deliberate deviation because Phase 3 owns captions. §4's three path domains table → Task 1 (the resolvers) and Task 3 (their use). `bundle({ publicDir })` → Task 3, passed absolute because Remotion resolves a relative one against its own root. `diagram.source` relative to the script file → Task 3 Step 1, including the three fixtures that must change with it. `publicAudioPath` namespacing left alone → respected; Task 3 changes only the directory it is joined onto. §6's `Root.tsx` risk → Task 5 Step 1, with the empty-`svgContent` fix rather than inlining 26KB. §6's `--no-file-parallelism` requirement → Task 3 Step 3 and Task 5 Step 7.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. The `<profile>` placeholders in Tasks 3 and 5 are runtime arguments the operator supplies.

**Type consistency.** `RenderVideoOptions` is `{ scriptPath, outPath, workDir }`, all absolute strings, defined in Task 2 and consumed unchanged in Tasks 3, 4 and 5. `packageRoot()`, `remotionEntryPoint()` and `resolveWorkDir(videoId, override?)` are defined in Task 1 and called with those exact signatures in Tasks 3, 4 and 5. `parseCliArgs` returns `CliCommand`, a union discriminated on `command`, and the entry point narrows on that field. `CliUsageError` is thrown by the parser and caught by name in the entry point.

**Ordering.** Task 1 is independent. Task 2 depends on nothing but must precede 3, 4 and 5. Task 3 needs 1 and 2. Task 4 needs 1, 2 and 3. Task 5 needs all of them. Tasks 3, 5 need a live Voicebox for their integration steps; everything else runs on `npm test` alone.
