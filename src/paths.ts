import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The package's own root.
 *
 * This file MUST stay at the top level of `src/`. The build emits `src/` to
 * `dist/` with `rootDir: "src"`, so this module lands at the top level of
 * `dist/` too — one level up is the package root both when running from
 * source under vitest and when running from the compiled bin. Move it into a
 * subdirectory and that stops being true in one of the two cases, silently.
 */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * What Remotion bundles. Resolved against the package, never the caller: a
 * consuming product runs `cuecast` from its own repo, where `src/remotion/`
 * does not exist. Remotion bundles TSX source rather than compiled output —
 * that is the supported path for its toolchain, and it is why `src` is in the
 * package's `files`.
 */
export function remotionEntryPoint(): string {
  return resolve(packageRoot(), "src", "remotion", "Root.tsx");
}

/**
 * Where a run's intermediates go: generated narration, copied audio, the
 * rendered SVG, the resolved script. Resolved against the CALLER's cwd, so a
 * run from another repo leaves its scratch there and never writes inside this
 * package (or, worse, inside somebody's node_modules).
 */
export function resolveWorkDir(videoId: string, override?: string): string {
  if (override !== undefined) {
    return resolve(process.cwd(), override);
  }
  return resolve(process.cwd(), ".cuecast", videoId);
}
