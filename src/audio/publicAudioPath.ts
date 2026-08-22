import { extname } from "node:path";

// The relative path (under Remotion's `public/` dir) a beat's audio file is
// copied to before bundling, so CuecastComposition can reach it via
// staticFile() regardless of where the source file originally lived. The
// beat id alone determines the path — the composition never needs a
// separate map to look one up.
export function publicAudioPath(beatId: string, sourcePath: string): string {
  return `audio/${beatId}${extname(sourcePath)}`;
}
