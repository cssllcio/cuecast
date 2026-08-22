import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderMermaidToSvg } from "./renderMermaidToSvg.js";

describe("renderMermaidToSvg", () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), "cuecast-mermaid-"));
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
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
