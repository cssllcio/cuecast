import { mkdirSync, readFileSync } from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { parseVideoScript } from "../../src/schema/videoScript.js";
import { cuecastWebpackOverride } from "../../src/remotion/webpackOverride.js";

async function maxVolumeDb(file: string, startSeconds: number, seconds: number) {
  // volumedetect over a slice: a whole-file measurement cannot see a duck,
  // because the loud parts set max_volume for the entire track.
  const { stderr } = await execa("ffmpeg", [
    "-ss", String(startSeconds),
    "-t", String(seconds),
    "-i", file,
    "-af", "volumedetect",
    "-f", "null",
    "-",
  ]);
  const match = stderr.match(/max_volume:\s*(-?\d+(\.\d+)?)\s*dB/);
  expect(match).not.toBeNull();
  return Number(match?.[1]);
}

describe("bed ducking", () => {
  it("plays the bed quieter under the narration it ducks", async () => {
    const videoScript = parseVideoScript(
      JSON.parse(readFileSync("test/fixtures/duck-proof-video.json", "utf-8"))
    );

    // staticFile() resolves against public/; the fixture's audioPath points
    // there, so the tone has to exist at that path before bundling.
    //
    // test/fixtures/tone.wav is only 1s long, but the bed spans 3s and this
    // test measures a window at 1.8s-2.3s. A plain copy would leave that
    // window silent because the underlying file has already ended — not
    // because anything ducked it — which would make this test pass even
    // with no ducking at all (confirmed: it did, before this loop was
    // added). Looping the tone to cover the whole bed span means the
    // "ducked" window has real signal that only a working duck can quiet.
    mkdirSync("public/audio/duck_proof", { recursive: true });
    await execa("ffmpeg", [
      "-y",
      "-stream_loop", "-1",
      "-i", "test/fixtures/tone.wav",
      "-t", "3.5",
      "-c", "copy",
      "public/audio/duck_proof/music.wav",
    ]);

    const svgContent = readFileSync("test/fixtures/render-proof-video.svg", "utf-8");
    const inputProps = { videoScript, svgContent };

    const bundleLocation = await bundle({
      entryPoint: "src/remotion/Root.tsx",
      webpackOverride: cuecastWebpackOverride,
    });
    // inputProps must be passed here as well as to renderMedia — omitting it
    // silently falls back to Root's defaultProps (the bug PR #3 fixed).
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "Cuecast",
      inputProps,
    });

    const outputLocation = "out/duck-proof.mp4";
    await renderMedia({
      composition: { ...composition, durationInFrames: 90 },
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation,
      inputProps,
    });

    // 0.2s-0.7s: bed alone, full gain. 1.8s-2.3s: inside the duck span,
    // clear of both 0.25s ramps.
    const openDb = await maxVolumeDb(outputLocation, 0.2, 0.5);
    const duckedDb = await maxVolumeDb(outputLocation, 1.8, 0.5);

    // duckTo 0.1 is a 20 dB drop; assert well over half of it to stay clear
    // of encoder noise while still proving a real, large reduction.
    expect(openDb - duckedDb).toBeGreaterThan(12);
  });
}, 120_000);
