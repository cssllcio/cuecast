import { extname } from "node:path";

// The relative path (under Remotion's `public/` dir) a beat's audio file is
// copied to before bundling, so CuecastComposition can reach it via
// staticFile() regardless of where the source file originally lived.
//
// Namespaced by video id so two videos that reuse a beat id (e.g. both
// have a `beat_01`) never overwrite each other's audio in public/audio/.
//
// Both ids end up as a path on disk, so a separator or parent reference in
// either would let a crafted id write outside public/audio/. The schema now
// rejects those far earlier (src/schema/videoScript.ts's idSchema, which is
// strictly narrower than this check), so in the normal flow these two calls
// never fire.
//
// They stay anyway, because this is the function that actually forms the
// path: it is exported, it takes plain strings, and a future caller reaching
// it with something the schema never saw should not be able to escape. The
// schema decides what an author may write; this guarantees what a path may
// be. Keeping both is why they are allowed to differ in strictness without
// ever disagreeing.
export function publicAudioPath(videoId: string, beatId: string, sourcePath: string): string {
  assertPathSafeId(videoId, "video id");
  assertPathSafeId(beatId, "beat id");
  return `audio/${videoId}/${beatId}${extname(sourcePath)}`;
}

// Two checks, two different hazards.
//
// Traversal: the separator check is load-bearing. Without a separator, ".."
// can never become its own path segment, so positional forms like "../x" or
// "x/../y" are already rejected and are deliberately not re-checked. The one
// traversal case that survives it is an id that IS "..": as a whole segment
// it walks up and out (`audio/../x` becomes `x`, landing in public/ instead
// of public/audio/). A substring such as "a..b" is a literal directory name
// and is allowed.
//
// Collision: "" and "." don't name a directory at all — they normalize away
// (`audio//x` and `audio/./x` both become `audio/x`), which silently undoes
// the per-video namespacing this function exists to provide.
export function assertPathSafeId(id: string, label: string): void {
  if (id.includes("/") || id.includes("\\")) {
    throw new Error(`${label} "${id}" must not contain a path separator`);
  }
  if (id === "" || id === "." || id === "..") {
    throw new Error(`${label} "${id}" must be a non-empty name, not "." or ".."`);
  }
}
