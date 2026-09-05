import { describe, expect, it } from "vitest";
import { CliUsageError, parseCliArgs } from "./parseArgs.js";

describe("parseCliArgs", () => {
  it("parses a build command", () => {
    expect(parseCliArgs(["build", "video.json", "--out", "out.mp4"])).toEqual({
      command: "build",
      scriptPath: "video.json",
      outPath: "out.mp4",
      workDir: undefined,
      captions: true,
    });
  });

  it("accepts a work-dir override", () => {
    expect(
      parseCliArgs(["build", "v.json", "--out", "o.mp4", "--work-dir", "tmp"])
    ).toMatchObject({ workDir: "tmp" });
  });

  it("recognises help and version before anything else", () => {
    expect(parseCliArgs(["--help"])).toEqual({ command: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ command: "help" });
    expect(parseCliArgs(["--version"])).toEqual({ command: "version" });
  });

  it("rejects no command at all", () => {
    expect(() => parseCliArgs([])).toThrow(CliUsageError);
  });

  it("rejects an unknown command, naming it", () => {
    expect(() => parseCliArgs(["render", "v.json"])).toThrow(/render/);
  });

  it("rejects a build with no script path", () => {
    expect(() => parseCliArgs(["build", "--out", "o.mp4"])).toThrow(/video\.json/);
  });

  it("rejects a build with no --out", () => {
    expect(() => parseCliArgs(["build", "v.json"])).toThrow(/--out/);
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(() => parseCliArgs(["build", "v.json", "--out", "o.mp4", "--wat"])).toThrow(
      CliUsageError
    );
  });

  it("rejects a stray extra positional", () => {
    expect(() =>
      parseCliArgs(["build", "v.json", "extra", "--out", "o.mp4"])
    ).toThrow(/extra/);
  });

  // Purity: the parser must not consult the filesystem or the cwd, so it can
  // be tested without chdir and so resolution stays the entry point's job.
  it("returns paths exactly as given, unresolved", () => {
    expect(parseCliArgs(["build", "./a/../b.json", "--out", "o.mp4"])).toMatchObject({
      scriptPath: "./a/../b.json",
    });
  });

  // resolveWorkDir(id, "") resolves to the caller's cwd rather than the
  // .cuecast/<id> default, because path.resolve ignores a zero-length
  // segment and the resolver's guard is `override !== undefined`. An empty
  // --work-dir is a typing mistake, not a request for the cwd, so reject it
  // here rather than letting a run's intermediates scatter loose.
  it("rejects an empty --work-dir", () => {
    expect(() =>
      parseCliArgs(["build", "v.json", "--out", "o.mp4", "--work-dir", ""])
    ).toThrow(CliUsageError);
  });
});

describe("--no-captions", () => {
  it("defaults to writing captions", () => {
    expect(parseCliArgs(["build", "v.json", "--out", "o.mp4"])).toMatchObject({
      captions: true,
    });
  });

  it("turns them off", () => {
    expect(
      parseCliArgs(["build", "v.json", "--out", "o.mp4", "--no-captions"])
    ).toMatchObject({ captions: false });
  });
});
