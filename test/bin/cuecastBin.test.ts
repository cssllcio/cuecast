import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import packageManifest from "../../package.json" with { type: "json" };

// This suite exercises the BUILT bin (dist/cli/cuecast.js), not the source —
// it needs `npm run build` to have already run first. That is why it lives
// in its own test/bin/ directory rather than in src/ (the fast `npm test`
// suite, `vitest run src`, which imports source directly and never touches
// dist/) or test/render/ (which bundles Root.tsx straight from source via
// @remotion/bundler and has no dist/ dependency either). Run explicitly with
// `npm run build && npm run test:bin`.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const distCuecastPath = join(repoRoot, "dist", "cli", "cuecast.js");

describe("cuecast bin, invoked the way npm actually invokes it", () => {
  it("runs when invoked through a symlink, as node_modules/.bin/cuecast is", async () => {
    expect(
      existsSync(distCuecastPath),
      `${distCuecastPath} does not exist — run \`npm run build\` before this suite`
    ).toBe(true);

    // npm installs `bin` entries as symlinks — node_modules/.bin/cuecast ->
    // ../cuecast/dist/cli/cuecast.js — and that symlink form is how
    // `npm install`, `npm link`, and `npx` all actually invoke this file.
    // Calling `node dist/cli/cuecast.js` directly (what every other test and
    // build step in this repo does) never exercises that path, which is
    // exactly how main()'s isMainModule() check having a symlink-unaware
    // comparison went unnoticed: it silently never ran main() for any real,
    // npm-installed invocation while still working for the direct form.
    const dir = mkdtempSync(join(tmpdir(), "cuecast-bin-test-"));
    const linkPath = join(dir, "cuecast");
    try {
      symlinkSync(distCuecastPath, linkPath);
      const { stdout, exitCode } = await execa("node", [linkPath, "--version"]);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe(packageManifest.version);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
