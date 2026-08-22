import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { VideoScript } from "../schema/videoScript.js";
import { secondsToFrame } from "../timing/frames.js";

export interface CuecastCompositionProps {
  videoScript: VideoScript;
  svgContent: string;
}

export interface AudioSequenceSpec {
  audioPath: string;
  fromFrame: number;
  durationInFrames: number;
}

// Every timing entry with an audioPath (narration audio, or a bed beat's
// supplied clip — see scripts/render-video.ts) gets its own Sequence, keyed
// to when that beat starts on the real timeline. durationInFrames bounds
// the Sequence to that beat's own timing span: a beat's timeline duration
// comes from Whisper's transcribed segment boundaries, not the generated
// audio file's own (possibly padded) length, so leaving the Sequence
// unbounded would let one beat's audio bleed into the next beat's window.
// A pure function so this mapping is unit-testable without rendering the
// composition.
export function buildAudioSequences(
  videoScript: VideoScript,
  fps: number
): AudioSequenceSpec[] {
  return videoScript.timing
    .filter((entry) => Boolean(entry.audioPath))
    .map((entry) => ({
      audioPath: entry.audioPath as string,
      // A position and a span on the timeline: nearest frame, not ceil —
      // see src/timing/frames.ts for why the two conversions differ.
      fromFrame: secondsToFrame(entry.startSeconds, fps),
      durationInFrames: secondsToFrame(entry.endSeconds - entry.startSeconds, fps),
    }));
}

export const CuecastComposition: React.FC<CuecastCompositionProps> = ({
  videoScript,
  svgContent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSeconds = frame / fps;

  const visibleGroups = new Set<string>();
  for (const beat of videoScript.script) {
    if (beat.type !== "narration" || !beat.reveal) continue;
    const timing = videoScript.timing.find((t) => t.beatId === beat.id);
    if (timing && currentSeconds >= timing.startSeconds) {
      for (const group of beat.reveal) visibleGroups.add(group);
    }
  }

  const audioSequences = buildAudioSequences(videoScript, fps);

  return (
    <AbsoluteFill style={{ backgroundColor: "white" }}>
      <div
        style={{ width: "100%", height: "100%" }}
        dangerouslySetInnerHTML={{
          __html: hideUnrevealedElements(
            svgContent,
            videoScript.diagram.revealGroups,
            visibleGroups
          ),
        }}
      />
      {audioSequences.map((sequence) => (
        <Sequence
          key={sequence.audioPath}
          from={sequence.fromFrame}
          durationInFrames={sequence.durationInFrames}
        >
          <Audio src={staticFile(sequence.audioPath)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// Only ids that belong to a revealGroup alias are ever toggled. Everything
// else in the SVG (the root <svg> element, <defs>/<symbol>/<marker> chrome,
// unaddressable Rel edges and System_Boundary rects — see Task 3's
// addressability spike) is left exactly as rendered and stays permanently
// visible.
//
// Mermaid aliases (e.g. "api") are NOT the literal id mmdc emits. mmdc's C4
// renderer prefixes every node id with its (default, hardcoded) `svgId`,
// e.g. `#my-svg-api` for the alias `api` — confirmed against the real
// rendered fixture SVG. So an alias is considered a match for a rendered id
// either by exact equality (in case a future svgId is empty/omitted) or by
// the rendered id ending in `-{alias}`.
function hideUnrevealedElements(
  svg: string,
  revealGroups: Record<string, string[]>,
  visibleGroupNames: Set<string>
): string {
  const idPattern = /id="([^"]+)"/g;
  const allIds = new Set(
    Array.from(svg.matchAll(idPattern), (match) => match[1])
  );

  const aliasToGroups = new Map<string, string[]>();
  for (const [group, aliases] of Object.entries(revealGroups)) {
    for (const alias of aliases) {
      const groups = aliasToGroups.get(alias) ?? [];
      groups.push(group);
      aliasToGroups.set(alias, groups);
    }
  }

  let result = svg;
  for (const id of allIds) {
    for (const [alias, groups] of aliasToGroups) {
      const matchesAlias = id === alias || id.endsWith(`-${alias}`);
      if (!matchesAlias) continue;

      const isVisible = groups.some((group) => visibleGroupNames.has(group));
      if (!isVisible) {
        result = result.replace(
          new RegExp(`(id="${id}"[^>]*)(>)`),
          `$1 style="opacity:0"$2`
        );
      }
      break;
    }
  }
  return result;
}
