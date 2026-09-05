import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { renderVideo } from "../../src/pipeline/renderVideo.js";
import { packageRoot } from "../../src/paths.js";

const baseUrl = process.env.CUECAST_TTS_URL;

describe.skipIf(!baseUrl)("renderVideo (live service, end to end)", () => {
  it("generates narration, lays out timing, and renders a video that actually carries the narration audio", async () => {
    const outputPath = "out/example-video.mp4";
    await renderVideo({
      scriptPath: resolve("test/fixtures/example-video.json"),
      outPath: resolve(outputPath),
      workDir: resolve(".cuecast/example_video"),
      captions: true,
    });

    expect(existsSync(outputPath)).toBe(true);

    // A file-exists check passed even while narration was silently dropped
    // (issue #1) and while inputProps never reached the composition (PR #3).
    // Remotion always muxes an AAC track, silent or not, so stream presence
    // proves nothing either; measure the signal. Silence sits at ffmpeg's
    // -91 dB floor — real narration is far above -50 dB.
    const { stderr } = await execa("ffmpeg", [
      "-i",
      outputPath,
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ]);
    const maxVolumeMatch = stderr.match(/max_volume:\s*(-?\d+(\.\d+)?)\s*dB/);
    expect(maxVolumeMatch).not.toBeNull();
    expect(Number(maxVolumeMatch?.[1])).toBeGreaterThan(-50);
  });

  // The property the whole change exists for. A file-level or duration-level
  // check would not catch a timing track that drifts; comparing the tracks
  // themselves is the thing itself.
  it("renders the same script to the same timing twice", async () => {
    const readTiming = (workDir: string) =>
      JSON.parse(
        readFileSync(resolve(workDir, "resolved-video.json"), "utf-8")
      ).timing;

    await renderVideo({
      scriptPath: resolve("test/fixtures/example-video.json"),
      outPath: resolve("out/repro-a.mp4"),
      workDir: resolve(".cuecast/repro_a"),
      captions: true,
    });
    const first = readTiming(".cuecast/repro_a");

    await renderVideo({
      scriptPath: resolve("test/fixtures/example-video.json"),
      outPath: resolve("out/repro-b.mp4"),
      workDir: resolve(".cuecast/repro_b"),
      captions: true,
    });
    const second = readTiming(".cuecast/repro_b");

    expect(second).toEqual(first);
    // Guard against the test passing vacuously if timing were ever empty.
    expect(first.length).toBeGreaterThan(0);
    expect(first.some((entry: { seed?: number }) => entry.seed !== undefined)).toBe(true);
  }, 600_000);

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
}, 600_000);
