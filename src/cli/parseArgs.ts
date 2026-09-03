import { parseArgs } from "node:util";

export interface BuildCommand {
  command: "build";
  /** Exactly as the user typed it — the entry point resolves it. */
  scriptPath: string;
  outPath: string;
  workDir: string | undefined;
}

export type CliCommand = BuildCommand | { command: "help" } | { command: "version" };

/** A mistake in how the command was typed, as opposed to a failure while running it. */
export class CliUsageError extends Error {}

/**
 * Pure: no filesystem access, no `process.cwd()`, no `process.exit`. That is
 * what lets the CLI's behaviour be covered by the fast unit suite without
 * spawning anything, and it keeps path resolution in one place (the entry
 * point) rather than smeared across both.
 */
export function parseCliArgs(argv: string[]): CliCommand {
  // Checked before subcommand parsing so `cuecast --help` works with no
  // command, which is what a user reaching for help has.
  if (argv.includes("--help") || argv.includes("-h")) return { command: "help" };
  if (argv.includes("--version")) return { command: "version" };

  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    throw new CliUsageError("no command given; try `cuecast --help`");
  }
  if (subcommand !== "build") {
    throw new CliUsageError(`unknown command "${subcommand}"; try \`cuecast --help\``);
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      strict: true,
      options: {
        out: { type: "string" },
        "work-dir": { type: "string" },
      },
    });
  } catch (error) {
    // strict:true rejects unknown flags — surface that as usage, not a crash.
    throw new CliUsageError((error as Error).message);
  }

  const [scriptPath, ...extra] = parsed.positionals;
  if (scriptPath === undefined) {
    throw new CliUsageError("build needs a path to a video.json");
  }
  if (extra.length > 0) {
    throw new CliUsageError(`unexpected argument "${extra[0]}"`);
  }
  const outPath = parsed.values.out;
  if (outPath === undefined) {
    throw new CliUsageError("build needs --out <file.mp4>");
  }

  const workDir = parsed.values["work-dir"];
  // resolveWorkDir(id, "") resolves to the caller's cwd rather than the
  // .cuecast/<id> default: path.resolve ignores a zero-length segment, and
  // the resolver's own guard (`override !== undefined`) lets "" through. An
  // empty --work-dir is a typing mistake, not a request for the cwd, so
  // reject it here rather than let a run's intermediates scatter loose.
  if (workDir === "") {
    throw new CliUsageError("--work-dir cannot be empty");
  }

  return {
    command: "build",
    scriptPath,
    outPath,
    workDir,
  };
}
