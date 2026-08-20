import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { renderMermaidToSvg } from "../src/mermaid/renderMermaidToSvg.js";
import { NarrationClient, type TranscribeResult } from "../src/narration/narrationClient.js";
import { buildTimingTrack } from "../src/timing/timingExtractor.js";
import { applyLexicon, mergeLexicons } from "../src/pronunciation/lexicon.js";
import { parseVideoScript, type VideoScript } from "../src/schema/videoScript.js";
import { cuecastWebpackOverride } from "../src/remotion/webpackOverride.js";
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
