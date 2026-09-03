import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  //
  // This assertion is only meaningful if the two sides can ever actually
  // disagree. `process.cwd().startsWith(packageRoot())` is true for the
  // whole rest of this file (vitest always runs with cwd === packageRoot()),
  // so a version of this test written that way would be an identity under
  // every condition this suite runs in — it would pass even if
  // resolveWorkDir resolved against packageRoot() for both branches instead
  // of process.cwd(), which is the exact regression this file exists to
  // catch. Actually chdir somewhere outside the package instead.
  it("does not put the work dir inside the package", () => {
    expect(resolveWorkDir("example_video").startsWith(packageRoot())).toBe(
      process.cwd().startsWith(packageRoot())
    );
  });

  describe("from a cwd outside the package", () => {
    let originalCwd: string;
    let outsideDir: string;

    beforeEach(() => {
      originalCwd = process.cwd();
      // realpath: on macOS, tmpdir() is under /tmp, a symlink to /private/tmp,
      // and process.cwd() after chdir reports the resolved path — comparing
      // the raw mkdtemp path against it would fail on a spurious
      // /tmp-vs-/private/tmp mismatch, not on the thing this test checks.
      outsideDir = realpathSync(mkdtempSync(join(tmpdir(), "cuecast-paths-test-")));
      process.chdir(outsideDir);
    });

    afterEach(() => {
      // Restore cwd before removing the tmpdir (and before any later test
      // runs) even if an assertion above throws, so one failure here cannot
      // poison the rest of the suite by leaving process.cwd() pointed at a
      // directory this test is about to delete.
      process.chdir(originalCwd);
      rmSync(outsideDir, { recursive: true, force: true });
    });

    it("resolves the work dir under that cwd, not under packageRoot()", () => {
      const workDir = resolveWorkDir("example_video");
      expect(workDir).toBe(join(outsideDir, ".cuecast", "example_video"));
      expect(workDir.startsWith(packageRoot())).toBe(false);
    });
  });
});
