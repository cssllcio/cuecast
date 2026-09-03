import React from "react";
import { Composition, registerRoot } from "remotion";
import {
  CuecastComposition,
  type CuecastCompositionProps,
} from "./CuecastComposition.js";
import { parseVideoScript } from "../schema/videoScript.js";
import { secondsToDurationFrames } from "../timing/frames.js";
import { timelineDurationSeconds } from "../timing/timelineDuration.js";

// A structurally-valid placeholder, not something anyone watches. Every real
// render passes inputProps — mandatory since PR #3 — so these defaults exist
// only to make the composition selectable. They deliberately do NOT import
// from test/, which does not ship: a published package's bundle must not
// reference fixtures.
const videoScript = parseVideoScript({
  id: "cuecast_default",
  diagram: { source: "diagram.mmd", revealGroups: {} },
  script: [],
  pronunciations: {},
  timing: [],
});
const svgContent = "";
const FPS = 30;

const RootComponent: React.FC = () => {
  // See src/timing/timelineDuration.ts: max over all entries, not the last
  // one, and a positive fallback for an empty or all-bed timing track.
  const durationInSeconds = timelineDurationSeconds(videoScript.timing);

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
