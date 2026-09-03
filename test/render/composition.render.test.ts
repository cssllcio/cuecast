import { existsSync, readFileSync, statSync } from "node:fs";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { bundle } from "@remotion/bundler";
import { describe, expect, it } from "vitest";
import { cuecastWebpackOverride } from "../../src/remotion/webpackOverride.js";
import { parseVideoScript } from "../../src/schema/videoScript.js";
import { timelineDurationSeconds } from "../../src/timing/timelineDuration.js";
import { secondsToDurationFrames } from "../../src/timing/frames.js";

const FPS = 30; // Must match Root.tsx's own FPS.

describe("Cuecast composition render", () => {
  it("renders the hand-written fixture video end to end", async () => {
    // test/fixtures/render-proof-video.svg is a durable, checked-in fixture
    // (generated once from generic-container.mmd via renderMermaidToSvg and
    // committed), read here directly rather than regenerated. Root.tsx no
    // longer depends on it — its own defaultProps are an empty placeholder —
    // so this test supplies the real fixture explicitly, the way its two
    // siblings (audioMux, duck) already do.
    const videoScript = parseVideoScript(
      JSON.parse(readFileSync("test/fixtures/render-proof-video.json", "utf-8"))
    );
    const svgContent = readFileSync("test/fixtures/render-proof-video.svg", "utf-8");
    const inputProps = { videoScript, svgContent };

    const bundleLocation = await bundle({
      entryPoint: "src/remotion/Root.tsx",
      webpackOverride: cuecastWebpackOverride,
    });
    // inputProps must be passed here as well as to renderMedia — omitting it
    // silently falls back to Root's (now empty) defaultProps, the bug PR #3
    // fixed.
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "Cuecast",
      inputProps,
    });

    // selectComposition's durationInFrames comes from Root.tsx's own
    // (now-empty) default videoScript, not from inputProps — Root.tsx sets
    // it statically from the module-level default, so it never reflects
    // whatever script is actually rendered. audioMux and duck already
    // override it at this call for the same reason; recompute it here from
    // the real fixture's own timing so the render covers the whole fixture
    // instead of being silently clamped to the empty default's 5s fallback.
    const durationInFrames = secondsToDurationFrames(
      timelineDurationSeconds(videoScript.timing),
      FPS
    );

    const outputLocation = "out/render-proof.mp4";
    await renderMedia({
      composition: { ...composition, durationInFrames },
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation,
      inputProps,
    });

    expect(existsSync(outputLocation)).toBe(true);
    expect(statSync(outputLocation).size).toBeGreaterThan(0);
  });
}, 120_000);
