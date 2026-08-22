import { extname } from "node:path";

// The relative path (under Remotion's `public/` dir) a beat's audio file is
// copied to before bundling, so CuecastComposition can reach it via
// staticFile() regardless of where the source file originally lived.
//
// Namespaced by video id so two videos that reuse a beat id (e.g. both
// have a `beat_01`) never overwrite each other's audio in public/audio/.
//
// Both ids come from free-form JSON and end up as a path on disk, so a
// separator or parent reference in either would let a crafted id write
// outside public/audio/. Reject them here, at the one place the path is
// formed.
export function publicAudioPath(videoId: string, beatId: string, sourcePath: string): string {
  assertPathSafeId(videoId, "video id");
  assertPathSafeId(beatId, "beat id");
  return `audio/${videoId}/${beatId}${extname(sourcePath)}`;
}

// The separator check is the load-bearing one for traversal: without a
// separator, ".." can never become its own path segment, so positional
// forms like "../x" or "x/../y" are already rejected and are deliberately
// not re-checked. A substring such as "a..b" is allowed — it is a literal
// directory name.
//
// The second check is about collisions, not traversal: "", "." and ".." are
// the only segments that don't name a real directory. "" and "." normalize
// away (`audio//x` and `audio/./x` both become `audio/x`), which silently
// undoes the per-video namespacing this function exists to provide.
function assertPathSafeId(id: string, label: string): void {
  if (id.includes("/") || id.includes("\\")) {
    throw new Error(`${label} "${id}" must not contain a path separator`);
  }
  if (id === "" || id === "." || id === "..") {
    throw new Error(`${label} "${id}" must be a non-empty name, not "." or ".."`);
  }
}
