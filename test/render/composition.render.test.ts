import { existsSync, statSync } from "node:fs";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { bundle } from "@remotion/bundler";
import { describe, expect, it } from "vitest";
import { cuecastWebpackOverride } from "../../src/remotion/webpackOverride.js";

describe("Cuecast composition render", () => {
  it("renders the hand-written fixture video end to end", async () => {
    // test/fixtures/render-proof-video.svg is a durable, checked-in fixture
    // (generated once from generic-container.mmd via renderMermaidToSvg and
    // committed) — Root.tsx depends on it existing in git regardless of
    // whether this test has run, so this test does not regenerate it.

    const bundleLocation = await bundle({
      entryPoint: "src/remotion/Root.tsx",
      webpackOverride: cuecastWebpackOverride,
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
