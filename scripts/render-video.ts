import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { renderMermaidToSvg } from "../src/mermaid/renderMermaidToSvg.js";
import { NarrationClient, type TranscribeResult } from "../src/narration/narrationClient.js";
import { buildTimingTrack } from "../src/timing/timingExtractor.js";
import { applyLexicon, mergeLexicons } from "../src/pronunciation/lexicon.js";
import { parseVideoScript, type VideoScript } from "../src/schema/videoScript.js";
import { cuecastWebpackOverride } from "../src/remotion/webpackOverride.js";
import { publicAudioPath } from "../src/audio/publicAudioPath.js";
import { probeAudioDurationSeconds } from "../src/audio/probeAudioDuration.js";
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
  mkdirSync("public/audio", { recursive: true });

  const client = new NarrationClient({ baseUrl, profileId });
  const transcriptions = new Map<string, TranscribeResult>();
  const bedDurations = new Map<string, number>();
  const audioPaths = new Map<string, string>();

  for (const beat of videoScript.script) {
    if (beat.type === "narration") {
      const spoken = beat.spoken || applyLexicon(beat.text, lexicon);
      const generated = await client.generate(spoken);
      const transcribed = await client.transcribe(generated.audioPath);
      transcriptions.set(beat.id, transcribed);

      const publicPath = publicAudioPath(beat.id, generated.audioPath);
      copyFileSync(generated.audioPath, `public/${publicPath}`);
      audioPaths.set(beat.id, publicPath);
    } else if (beat.type === "bed") {
      const duration = await probeAudioDurationSeconds(beat.audio);
      bedDurations.set(beat.id, duration);

      const publicPath = publicAudioPath(beat.id, beat.audio);
      copyFileSync(beat.audio, `public/${publicPath}`);
      audioPaths.set(beat.id, publicPath);
    }
  }

  const timing = buildTimingTrack(videoScript.script, transcriptions, bedDurations).map(
    (entry) => {
      const audioPath = audioPaths.get(entry.beatId);
      return audioPath ? { ...entry, audioPath } : entry;
    }
  );
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
