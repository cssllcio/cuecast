import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderMermaidToSvg, type RendererCommand } from "./renderMermaidToSvg.js";

const COMPLETE_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><g id="api"/></svg>';

// Stand-in renderers, as real child processes rather than mocks: the whole
// point of these tests is how we treat a process we do not control, so a
// mocked spawn would test nothing. Each writes to the same svgPath mmdc
// would, then behaves the way a real renderer might misbehave.
function nodeRenderer(body: string): RendererCommand {
  return ({ svgPath }) => ({
    file: process.execPath,
    args: ["-e", `const svgPath=${JSON.stringify(svgPath)};${body}`],
  });
}

const WRITES_THEN_EXITS = nodeRenderer(
  `require("fs").writeFileSync(svgPath, ${JSON.stringify(COMPLETE_SVG)});`
);

// The real failure on macOS 26: mmdc writes a correct SVG, then mermaid-cli's
// `finally { await browser.close() }` never resolves because Chrome <=152
// refuses to exit. Output is perfect; the process simply never returns.
const WRITES_THEN_HANGS = nodeRenderer(
  `require("fs").writeFileSync(svgPath, ${JSON.stringify(COMPLETE_SVG)});` +
    `setInterval(() => {}, 1000);`
);

const HANGS_WITHOUT_WRITING = nodeRenderer(`setInterval(() => {}, 1000);`);

const EXITS_WITHOUT_WRITING = nodeRenderer(`process.exit(0);`);

describe("renderMermaidToSvg", () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), "cuecast-mermaid-"));
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  it("returns the SVG when the renderer exits on its own", async () => {
    const result = await renderMermaidToSvg({
      inputPath: "test/fixtures/generic-container.mmd",
      outputDir,
      rendererCommand: WRITES_THEN_EXITS,
    });

    expect(existsSync(result.svgPath)).toBe(true);
    expect(result.svg).toContain("<svg");
  });

  it("returns the SVG when the renderer writes its output and then never exits", async () => {
    const result = await renderMermaidToSvg({
      inputPath: "test/fixtures/generic-container.mmd",
      outputDir,
      rendererCommand: WRITES_THEN_HANGS,
    });

    expect(result.svg).toContain("<svg");
    expect(result.svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("throws once the timeout elapses if the renderer never produces output", async () => {
    await expect(
      renderMermaidToSvg({
        inputPath: "test/fixtures/generic-container.mmd",
        outputDir,
        rendererCommand: HANGS_WITHOUT_WRITING,
        timeoutMs: 1_000,
      })
    ).rejects.toThrow(/timed out/i);
  });

  it("throws naming the expected path when the renderer exits without writing", async () => {
    await expect(
      renderMermaidToSvg({
        inputPath: "test/fixtures/generic-container.mmd",
        outputDir,
        rendererCommand: EXITS_WITHOUT_WRITING,
      })
    ).rejects.toThrow(/generic-container\.svg/);
  });

  it("renders a C4Container diagram to an SVG file", async () => {
    const result = await renderMermaidToSvg({
      inputPath: "test/fixtures/generic-container.mmd",
      outputDir,
    });

    expect(existsSync(result.svgPath)).toBe(true);
    expect(result.svg).toContain("<svg");
  });
}, 30_000);
