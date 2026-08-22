import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { cuecastWebpackOverride } from "../../src/remotion/webpackOverride.js";
import { publicAudioPath } from "../../src/audio/publicAudioPath.js";
import type { VideoScript } from "../../src/schema/videoScript.js";

describe("Cuecast composition audio muxing", () => {
  it("mixes a bed beat's audio into the rendered video", async () => {
    // Proves the audio-muxing mechanism (schema audioPath -> composition
    // Audio/Sequence -> renderMedia) end to end without needing a live TTS
    // service: a bed beat's audio is already a static file (test/fixtures/
    // tone.wav, a real 1s 440Hz WAV, not a mock), so this exercises exactly
    // the copy-into-public/ + staticFile() path scripts/render-video.ts uses
    // for narration audio too, just without the generate/transcribe calls.
    //
    // This also happens to be the first test in the project that renders a
    // videoScript OTHER than Root.tsx's baked-in defaultProps fixture — which
    // is how it caught a real bug: renderMedia's own inputProps alone never
    // reached the component (it renders whatever selectComposition already
    // resolved), so inputProps must be passed to selectComposition too. See
    // the matching comment in scripts/render-video.ts.
    // Build the public path with the real helper so this test exercises the
    // same video-id namespacing scripts/render-video.ts uses (issue #4).
    const bedPublicPath = publicAudioPath("audio_mux_proof", "beat_bed", "test/fixtures/tone.wav");
    mkdirSync(dirname(`public/${bedPublicPath}`), { recursive: true });
    copyFileSync("test/fixtures/tone.wav", `public/${bedPublicPath}`);

    const videoScript: VideoScript = {
      id: "audio_mux_proof",
      diagram: { source: "test/fixtures/generic-container.mmd", revealGroups: {} },
      script: [{ id: "beat_bed", type: "bed", audio: "test/fixtures/tone.wav" }],
      pronunciations: {},
      timing: [
        {
          beatId: "beat_bed",
          startSeconds: 0,
          endSeconds: 1,
          audioPath: bedPublicPath,
        },
      ],
    };
    const svgContent = readFileSync("test/fixtures/render-proof-video.svg", "utf-8");
    const inputProps = { videoScript, svgContent };

    const bundleLocation = await bundle({
      entryPoint: "src/remotion/Root.tsx",
      webpackOverride: cuecastWebpackOverride,
    });
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "Cuecast",
      inputProps,
    });

    const outputLocation = "out/audio-mux-proof.mp4";
    await renderMedia({
      composition: { ...composition, durationInFrames: 30 },
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation,
      inputProps,
    });

    expect(existsSync(outputLocation)).toBe(true);

    // A stream-presence check alone is not a valid test here: Remotion's
    // h264 renders always carry an AAC audio stream, silent or not (verified
    // against the audio-free render-proof-video.json fixture — both a truly
    // silent render and this one report an "audio" stream). volumedetect
    // reports the real signal level; a silent track sits at ffmpeg's -91dB
    // floor, so a materially higher max_volume proves the tone actually
    // reached the output, not just that some audio track exists.
    const { stderr } = await execa("ffmpeg", [
      "-i",
      outputLocation,
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ]);
    const maxVolumeMatch = stderr.match(/max_volume:\s*(-?\d+(\.\d+)?)\s*dB/);
    expect(maxVolumeMatch).not.toBeNull();
    const maxVolumeDb = Number(maxVolumeMatch?.[1]);
    expect(maxVolumeDb).toBeGreaterThan(-50);
  });
}, 120_000);
