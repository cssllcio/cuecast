import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cuecast.js";

// videoScript.id is bare z.string() (src/schema/videoScript.ts) but is used
// as a filesystem path twice over: resolveWorkDir names the run's whole work
// dir after it, and renderVideo later feeds it to publicAudioPath. main()
// must reject an unsafe id itself, before either of those — in particular
// before renderVideo ever gets a chance to start a TTS round trip or write
// into a work dir the id itself corrupted.
function writeScript(dir: string, id: string): string {
  const path = join(dir, "video.json");
  writeFileSync(
    path,
    JSON.stringify({
      id,
      diagram: { source: "diagram.mmd", revealGroups: {} },
      script: [{ id: "s1", type: "silence", duration: 1 }],
      pronunciations: {},
      timing: [],
    })
  );
  return path;
}

describe("cuecast CLI: video id safety", () => {
  let dir: string;
  let stderr: string[];

  // A helper, rather than an inline call assigned to a pre-typed variable:
  // vi.spyOn's return type depends on process.stderr.write's overloads, and
  // `ReturnType<typeof vi.spyOn>` alone (with no type arguments) can't
  // resolve which one — letting TS infer the variable's type from this
  // function's return sidesteps that entirely.
  function spyOnStderr() {
    return vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(chunk.toString());
      return true;
    });
  }
  let stderrSpy: ReturnType<typeof spyOnStderr>;
  let savedTtsUrl: string | undefined;
  let savedTtsProfile: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cuecast-cli-test-"));
    stderr = [];
    stderrSpy = spyOnStderr();
    // Removed so a normal id's run is guaranteed to fail at the env check,
    // never reaching renderVideo (and therefore never touching the network)
    // regardless of what is set in the ambient environment running this suite.
    savedTtsUrl = process.env.CUECAST_TTS_URL;
    savedTtsProfile = process.env.CUECAST_TTS_PROFILE_ID;
    delete process.env.CUECAST_TTS_URL;
    delete process.env.CUECAST_TTS_PROFILE_ID;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    if (savedTtsUrl === undefined) delete process.env.CUECAST_TTS_URL;
    else process.env.CUECAST_TTS_URL = savedTtsUrl;
    if (savedTtsProfile === undefined) delete process.env.CUECAST_TTS_PROFILE_ID;
    else process.env.CUECAST_TTS_PROFILE_ID = savedTtsProfile;
  });

  it('rejects a ".." id immediately, with a clear message, before the env check', async () => {
    const scriptPath = writeScript(dir, "..");
    const exitCode = await main(["build", scriptPath, "--out", join(dir, "out.mp4")]);
    expect(exitCode).toBe(1);
    // The rejection moved into the schema, so the message names the field
    // path and the rule rather than restating the value.
    expect(stderr.join("")).toMatch(/is not a valid video script/);
    expect(stderr.join("")).toMatch(/\bid: must contain only letters, digits/);
  });

  it("does not print a raw ZodError dump", async () => {
    const scriptPath = writeScript(dir, "docs/intro");
    await main(["build", scriptPath, "--out", join(dir, "out.mp4")]);
    const output = stderr.join("");
    // A ZodError's `.message` is its issue array serialised as JSON. If that
    // ever reaches a terminal again, these are the tells.
    expect(output).not.toMatch(/"validation"/);
    expect(output).not.toMatch(/"code":/);
  });

  it('rejects a "docs/intro" id (a plausible non-malicious id containing a separator)', async () => {
    const scriptPath = writeScript(dir, "docs/intro");
    const exitCode = await main(["build", scriptPath, "--out", join(dir, "out.mp4")]);
    expect(exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/is not a valid video script/);
    expect(stderr.join("")).toMatch(/\bid: must contain only letters, digits/);
  });

  it("lets a normal id past the safety check (fails later, at the env check, not on the id)", async () => {
    const scriptPath = writeScript(dir, "normal_video_id");
    const exitCode = await main(["build", scriptPath, "--out", join(dir, "out.mp4")]);
    expect(exitCode).toBe(1);
    const message = stderr.join("");
    expect(message).toMatch(/CUECAST_TTS_URL/);
    expect(message).not.toMatch(/path separator|non-empty name/);
  });
});
