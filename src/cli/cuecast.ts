#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CliUsageError, parseCliArgs } from "./parseArgs.js";
import { packageRoot, resolveWorkDir } from "../paths.js";
import { renderVideo } from "../pipeline/renderVideo.js";
import { parseVideoScript } from "../schema/videoScript.js";
import { assertPathSafeId } from "../audio/publicAudioPath.js";

const USAGE = `cuecast — narration-timed reveal animations

Usage:
  cuecast build <video.json> --out <out.mp4> [--work-dir <dir>]
  cuecast --help
  cuecast --version

Options:
  --out <file>       Where to write the rendered video. Required.
  --work-dir <dir>   Where to put this run's intermediates.
                     Defaults to .cuecast/<video id> under the current directory.

Environment:
  CUECAST_TTS_URL          Base URL of a running Voicebox instance.
  CUECAST_TTS_PROFILE_ID   Voice profile to generate narration with.
`;

function version(): string {
  const manifest = JSON.parse(
    readFileSync(join(packageRoot(), "package.json"), "utf-8")
  ) as { version: string };
  return manifest.version;
}

export async function main(argv: string[]): Promise<number> {
  let command;
  try {
    command = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      process.stderr.write(`cuecast: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  if (command.command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command.command === "version") {
    process.stdout.write(`${version()}\n`);
    return 0;
  }

  const scriptPath = resolve(process.cwd(), command.scriptPath);
  const outPath = resolve(process.cwd(), command.outPath);

  // Parsed here as well as inside renderVideo, deliberately: the work dir's
  // default is named after the video id, and reading the script now means a
  // malformed one fails immediately with a clear message rather than after
  // the first TTS round trip.
  let videoId: string;
  try {
    videoId = parseVideoScript(JSON.parse(readFileSync(scriptPath, "utf-8"))).id;
    // The id becomes a filesystem path twice over: resolveWorkDir below
    // names this run's whole work dir after it, and renderVideo later feeds
    // it to publicAudioPath. Validate it here, before either happens, so a
    // "." or ".." id (or one with a separator) fails immediately instead of
    // silently writing outside the work dir it was supposed to be confined
    // to, or paying for a TTS round trip before dying on the audio path.
    assertPathSafeId(videoId, "video id");
  } catch (error) {
    process.stderr.write(`cuecast: ${scriptPath}: ${(error as Error).message}\n`);
    return 1;
  }

  // Load-bearing, not redundant with renderVideo's own check: without this,
  // a missing TTS env var would only surface after the id/work-dir setup
  // above, and — for a narration-bearing script — after renderVideo has
  // already started writing into the work dir.
  if (!process.env.CUECAST_TTS_URL || !process.env.CUECAST_TTS_PROFILE_ID) {
    process.stderr.write(
      "cuecast: set CUECAST_TTS_URL and CUECAST_TTS_PROFILE_ID — both are required to generate narration\n"
    );
    return 1;
  }

  try {
    await renderVideo({
      scriptPath,
      outPath,
      workDir: resolveWorkDir(videoId, command.workDir),
    });
  } catch (error) {
    process.stderr.write(`cuecast: ${(error as Error).message}\n`);
    return 1;
  }
  process.stdout.write(`${outPath}\n`);
  return 0;
}

// Guarded so importing this module (e.g. from a test) does not also run the
// CLI against the importing process's own argv — only running it directly
// (`node dist/cli/cuecast.js`, or via the `cuecast` bin symlink) does.
//
// Comparing plain resolve(process.argv[1]) against import.meta.url is wrong:
// resolve() does not follow symlinks, but Node resolves import.meta.url to
// the real, symlink-followed path. npm installs `bin` entries as symlinks
// (node_modules/.bin/cuecast -> .../dist/cli/cuecast.js), which is how
// `npm install`, `npm link`, and `npx` all invoke this file — so that
// comparison was false for every real installed invocation and main() never
// ran. realpathSync follows the symlink so the comparison matches reality;
// it's wrapped because argv[1] is not guaranteed to name an existing file in
// every invocation context, and a throwing realpathSync must not crash the
// module at load (falling through to "not main" is the safe default).
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await main(process.argv.slice(2));
}
