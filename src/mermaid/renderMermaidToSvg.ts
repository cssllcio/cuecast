import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { execa } from "execa";

const require = createRequire(import.meta.url);

export interface RenderMermaidOptions {
  inputPath: string;
  outputDir: string;
  /**
   * Test seam, following the `fetchImpl` precedent in NarrationClient: lets a
   * test substitute a renderer that misbehaves in a specific way. Production
   * callers leave it unset and get mmdc.
   */
  rendererCommand?: RendererCommand;
  timeoutMs?: number;
}

export interface RenderMermaidResult {
  svgPath: string;
  svg: string;
}

export interface RendererCommandContext {
  inputPath: string;
  svgPath: string;
  puppeteerConfigPath: string;
}

export type RendererCommand = (context: RendererCommandContext) => {
  file: string;
  args: string[];
};

// mmdc's own render takes ~4s; the ceiling is for a cold Chrome start, not for
// the hang below, which is detected by the output appearing rather than by
// waiting this out.
const DEFAULT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 50;

// Resolved via Node's own module resolution from this file's location, not
// spawned via `npx`. `npx mmdc` resolves against the CALLER's cwd: outside
// this repo that finds no local install and falls through to whatever `mmdc`
// happens to be on PATH (a different mermaid-cli, with its own puppeteer
// cache that may not have chrome-headless-shell installed) — or nothing at
// all. `require.resolve` instead walks up from this module's own location,
// which finds the dependency correctly whether npm nested it under this
// package or hoisted it to a consumer's top-level node_modules.
//
// The package only exports its "." subpath (see its package.json), not
// "./src/cli.js" — resolving "." and deriving the sibling cli.js from its
// directory stays within what the package actually publishes as resolvable.
//
// Resolved lazily (on first render) rather than at module load, so an
// installed-without-its-dependency situation surfaces as an actionable
// cuecast error from the code path that needs it, not as a raw Node
// MODULE_NOT_FOUND stack the moment anything imports this file.
let cachedMmdcCliPath: string | undefined;
function resolveMmdcCliPath(): string {
  if (cachedMmdcCliPath !== undefined) return cachedMmdcCliPath;
  try {
    cachedMmdcCliPath = join(
      dirname(require.resolve("@mermaid-js/mermaid-cli")),
      "cli.js"
    );
    return cachedMmdcCliPath;
  } catch (error) {
    throw new Error(
      "cuecast: could not find @mermaid-js/mermaid-cli, which renderMermaidToSvg " +
        "needs to render the diagram. Run `npm install` in the cuecast package.",
      { cause: error }
    );
  }
}

const mmdcCommand: RendererCommand = ({
  inputPath,
  svgPath,
  puppeteerConfigPath,
}) => ({
  file: process.execPath,
  args: [
    resolveMmdcCliPath(),
    "-i",
    inputPath,
    "-o",
    svgPath,
    "--puppeteerConfigFile",
    puppeteerConfigPath,
  ],
});

/**
 * Renders a Mermaid diagram to SVG.
 *
 * We deliberately do not wait for the renderer to exit. On macOS 26, Chrome
 * <=152 acknowledges CDP `Browser.close` and then never terminates — it also
 * ignores SIGTERM, and only SIGKILL ends it. mermaid-cli closes its browser in
 * a `finally` that runs *after* it has written the SVG, so mmdc produces a
 * completely correct file and then hangs forever. Awaiting its exit, as this
 * function used to, turned a successful render into an indefinite block.
 *
 * So the real completion signal is the output file, not the exit code: once a
 * complete SVG is on disk the render has succeeded by definition, and the
 * process is killed rather than waited on. A renderer that exits cleanly still
 * takes the normal path — this only changes what happens when one doesn't.
 */
export async function renderMermaidToSvg(
  options: RenderMermaidOptions
): Promise<RenderMermaidResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const outputName = basename(options.inputPath).replace(/\.mmd$/, ".svg");
  const svgPath = join(options.outputDir, outputName);

  const tempDir = mkdtempSync(join(tmpdir(), "mmdc-config-"));
  const puppeteerConfigPath = join(tempDir, "puppeteer-config.json");
  writeFileSync(puppeteerConfigPath, JSON.stringify({ args: ["--no-sandbox"] }));

  const command = (options.rendererCommand ?? mmdcCommand)({
    inputPath: options.inputPath,
    svgPath,
    puppeteerConfigPath,
  });

  // detached so the renderer leads its own process group, giving us something
  // to kill wholesale; reject:false because we expect to kill it and a thrown
  // signal error would mask a successful render.
  const child = execa(command.file, command.args, {
    detached: true,
    reject: false,
  });

  let exit: { exitCode?: number; stderr?: string } | undefined;
  void child.then(
    (result) => {
      exit = result;
    },
    (error: Error) => {
      exit = { stderr: error.message };
    }
  );

  try {
    const deadline = Date.now() + timeoutMs;
    let svg: string | undefined;

    while (Date.now() < deadline) {
      svg = readCompleteSvg(svgPath);
      if (svg !== undefined) break;
      // Checked after the file, so a renderer that writes and exits in the
      // same interval is still treated as a success.
      if (exit !== undefined) {
        svg = readCompleteSvg(svgPath);
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (svg !== undefined) return { svgPath, svg };

    if (exit !== undefined) {
      const detail = exit.stderr?.trim();
      throw new Error(
        `mermaid render exited (code ${exit.exitCode ?? "unknown"}) without writing ${svgPath}` +
          (detail ? `: ${detail}` : "")
      );
    }

    throw new Error(
      `mermaid render timed out after ${timeoutMs}ms without writing ${svgPath}`
    );
  } finally {
    await killTree(child.pid);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// A partially written file is the one way this could go wrong, so completeness
// is judged by the closing tag rather than by the file merely existing.
function readCompleteSvg(svgPath: string): string | undefined {
  try {
    const svg = readFileSync(svgPath, "utf-8");
    return svg.trimEnd().endsWith("</svg>") ? svg : undefined;
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Puppeteer spawns Chrome detached, so it leaves our process group and would
 * survive killing the renderer alone — one orphaned Chrome per render, each
 * holding memory indefinitely because this is the very Chrome that won't exit.
 * Descendants are collected before anything is killed, while the parent links
 * still exist.
 */
async function killTree(pid: number | undefined): Promise<void> {
  if (pid === undefined) return;

  const tree = await descendantPids(pid);
  for (const target of [...tree.reverse(), pid]) {
    try {
      process.kill(target, "SIGKILL");
    } catch {
      // Already gone — the normal case when the renderer exited on its own.
    }
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // No surviving process group.
  }
}

async function descendantPids(pid: number): Promise<number[]> {
  const found: number[] = [];
  const queue = [pid];

  while (queue.length > 0) {
    const current = queue.shift() as number;
    const result = await execa("pgrep", ["-P", String(current)], {
      reject: false,
    });
    const children = String(result.stdout ?? "")
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);
    found.push(...children);
    queue.push(...children);
  }

  return found;
}
