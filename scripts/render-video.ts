import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
    // Same fix Task 8 needed (see test/render/composition.render.test.ts):
    // Remotion's default webpack config only probes .ts/.tsx for
    // extensionless imports, so it can't resolve Root.tsx's explicit
    // ".js"-suffixed imports that actually point at ".tsx" source.
    // `extensionAlias` makes ".js" fall back to .ts/.tsx.
    //
    // Root.tsx also needs a checked-in fixture SVG's raw text (embedded in
    // its `defaultProps` for the "Cuecast" composition's default), but
    // Root.tsx is bundled for and executed inside the headless browser
    // Remotion renders with, where `node:fs` isn't available. The `?raw`
    // import convention resolves to the file's raw text via `asset/source`
    // instead of Remotion's default `asset/resource` (a URL string), and is
    // excluded from the default asset/resource rule so the two module rules
    // don't both claim the same import.
    webpackOverride: (config) => {
      const rules = (config.module?.rules ?? []).map((rule) => {
        if (
          rule &&
          typeof rule === "object" &&
          rule.type === "asset/resource"
        ) {
          return { ...rule, resourceQuery: { not: [/raw/] } };
        }
        return rule;
      });

      return {
        ...config,
        resolve: {
          ...config.resolve,
          extensionAlias: {
            ".js": [".js", ".ts", ".tsx"],
          },
        },
        module: {
          ...config.module,
          rules: [{ resourceQuery: /raw/, type: "asset/source" }, ...rules],
        },
      };
    },
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
