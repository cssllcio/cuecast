import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { packageRoot, remotionEntryPoint, resolveWorkDir } from "./paths.js";

describe("packageRoot", () => {
  it("points at the directory holding package.json", () => {
    expect(existsSync(join(packageRoot(), "package.json"))).toBe(true);
  });

  it("is absolute", () => {
    expect(isAbsolute(packageRoot())).toBe(true);
  });
});

describe("remotionEntryPoint", () => {
  // Remotion bundles from TSX source, not from dist, which is why `src` ships
  // in the package's files list.
  it("points at a file that exists", () => {
    expect(existsSync(remotionEntryPoint())).toBe(true);
    expect(remotionEntryPoint().endsWith("src/remotion/Root.tsx")).toBe(true);
  });
});

describe("resolveWorkDir", () => {
  it("defaults to .cuecast/<videoId> under the caller's cwd", () => {
    expect(resolveWorkDir("example_video")).toBe(
      join(process.cwd(), ".cuecast", "example_video")
    );
  });

  it("resolves an override against the caller's cwd", () => {
    expect(resolveWorkDir("example_video", "tmp/run")).toBe(
      join(process.cwd(), "tmp", "run")
    );
  });

  it("leaves an absolute override alone", () => {
    expect(resolveWorkDir("example_video", "/tmp/run")).toBe("/tmp/run");
  });

  // The work dir belongs to the caller, not the package — that is the whole
  // point of the split. A run from another repo must not write here.
  it("does not put the work dir inside the package", () => {
    expect(resolveWorkDir("example_video").startsWith(packageRoot())).toBe(
      process.cwd().startsWith(packageRoot())
    );
  });
});
