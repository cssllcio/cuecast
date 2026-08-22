import React from "react";
import { Composition, registerRoot } from "remotion";
import {
  CuecastComposition,
  type CuecastCompositionProps,
} from "./CuecastComposition.js";
import { parseVideoScript } from "../schema/videoScript.js";
import { secondsToDurationFrames } from "../timing/frames.js";
import proofFixture from "../../test/fixtures/render-proof-video.json" with { type: "json" };
// A durable, checked-in fixture (see test/fixtures/render-proof-video.svg) —
// generated once from generic-container.mmd via renderMermaidToSvg and
// committed, not produced as a side effect of running a test. Root.tsx is
// bundled by Task 9's end-to-end script too, so its dependency must exist in
// git regardless of test execution order.
//
// This is imported (not `readFileSync`'d) because Root.tsx is bundled by
// webpack and executed inside the headless browser Remotion renders with —
// there is no Node.js `fs` module available at runtime there. The `?raw`
// suffix is resolved to the file's raw text content by a webpack rule added
// in the render test's `webpackOverride` (see
// test/render/composition.render.test.ts); see also src/remotion/svg-raw.d.ts
// for the matching ambient type declaration.
import svgContent from "../../test/fixtures/render-proof-video.svg?raw";

const videoScript = parseVideoScript(proofFixture);
const FPS = 30;

const RootComponent: React.FC = () => {
  const lastTiming = videoScript.timing.at(-1);
  const durationInSeconds = lastTiming?.endSeconds ?? 5;

  return (
    <Composition<any, CuecastCompositionProps & Record<string, unknown>>
      id="Cuecast"
      component={CuecastComposition}
      durationInFrames={secondsToDurationFrames(durationInSeconds, FPS)}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ videoScript, svgContent }}
    />
  );
};

registerRoot(RootComponent);
