import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { renderMermaidToSvg } from "../src/mermaid/renderMermaidToSvg.js";
import { NarrationClient } from "../src/narration/narrationClient.js";
import { resolveBeatSeed } from "../src/narration/beatSeed.js";
import {
  buildTimingTrack,
  decorateTimingTrack,
  describeBedClamps,
} from "../src/timing/timingExtractor.js";
import { mergeLexicons } from "../src/pronunciation/lexicon.js";
import { spokenForBeat } from "../src/pronunciation/spokenForBeat.js";
import { parseVideoScript, type VideoScript } from "../src/schema/videoScript.js";
import { cuecastWebpackOverride } from "../src/remotion/webpackOverride.js";
import { publicAudioPath } from "../src/audio/publicAudioPath.js";
import { probeAudioDurationSeconds } from "../src/audio/probeAudioDuration.js";
import { secondsToDurationFrames } from "../src/timing/frames.js";
import { timelineDurationSeconds } from "../src/timing/timelineDuration.js";
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

  // Remotion renders the composition inside a headless browser, which can't
  // read arbitrary filesystem paths — audio has to be copied into public/
  // (Remotion's static-asset convention, matching how Root.tsx's SVG fixture
  // already resolves this same constraint) before bundle() runs, below.
  // Audio is namespaced under the video id (issue #4) so two videos that
  // reuse a beat id can't clobber each other; the helper creates the
  // public/audio/<videoId>/ directory itself.
  function copyBeatAudioToPublic(beatId: string, sourcePath: string): string {
    const publicPath = publicAudioPath(videoScript.id, beatId, sourcePath);
    const destination = `public/${publicPath}`;
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(sourcePath, destination);
    return publicPath;
  }

  // Voicebox returns each generation's real audio length, so narration and
  // bed beats feed one durations map — there is no transcription step (its
  // /transcribe endpoint carries no timestamps; see issue #6).
  const client = new NarrationClient({
    baseUrl,
    profileId,
    audioOutputDir: "generated/narration",
  });
  const durations = new Map<string, number>();
  const audioPaths = new Map<string, string>();
  const seeds = new Map<string, number>();

  for (const beat of videoScript.script) {
    if (beat.type === "narration") {
      const spoken = spokenForBeat(beat, lexicon);
      const seed = resolveBeatSeed(beat, videoScript.id);
      const { audioPath, durationSeconds } = await client.generate(spoken, seed);
      durations.set(beat.id, durationSeconds);
      seeds.set(beat.id, seed);
      audioPaths.set(beat.id, copyBeatAudioToPublic(beat.id, audioPath));
    } else if (beat.type === "bed") {
      durations.set(beat.id, await probeAudioDurationSeconds(beat.audio));
      audioPaths.set(beat.id, copyBeatAudioToPublic(beat.id, beat.audio));
    }
  }

  const timing = decorateTimingTrack(
    buildTimingTrack(videoScript.script, durations),
    audioPaths,
    seeds
  );
  for (const clamp of describeBedClamps(videoScript.script, durations, timing)) {
    console.error(
      `cuecast: bed beat "${clamp.beatId}" was cut from ${clamp.requestedSeconds.toFixed(2)}s ` +
        `to ${clamp.actualSeconds.toFixed(2)}s — it outlasts the narration it plays under`
    );
  }
  const finalVideoScript: VideoScript = { ...videoScript, timing };

  // renderMermaidToSvg (and mmdc underneath it) refuses to write into a
  // missing output directory ("Output directory ... doesn't exist") rather
  // than creating one, unlike its own test which pre-creates a temp dir —
  // confirmed by running it against a fresh checkout with no `generated/`
  // present. `generated/` is gitignored, so it won't exist on a clean clone.
  mkdirSync("generated", { recursive: true });

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

  const bundleLocation = await bundle({
    entryPoint: "src/remotion/Root.tsx",
    webpackOverride: cuecastWebpackOverride,
  });
  const inputProps = { videoScript: finalVideoScript, svgContent };

  // inputProps MUST be passed to selectComposition, not only renderMedia.
  // selectComposition resolves the composition's metadata (including its
  // props) once and freezes it; renderMedia's own `composition` argument
  // (built from that frozen metadata below) short-circuits the in-browser
  // prop-resolution path renderMedia would otherwise use to merge inputProps
  // in. Passing inputProps only to renderMedia compiles and renders — using
  // Root.tsx's hardcoded default props instead, silently — which is exactly
  // how this went unnoticed: confirmed by a debug probe showing the
  // component receiving Root.tsx's fixture videoScript.id regardless of
  // what was passed to renderMedia alone.
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "Cuecast",
    inputProps,
  });

  await renderMedia({
    composition: {
      ...composition,
      durationInFrames: secondsToDurationFrames(
        timelineDurationSeconds(finalVideoScript.timing),
        composition.fps
      ),
    },
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
  });
}
