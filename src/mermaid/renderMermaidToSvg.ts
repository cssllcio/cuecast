import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";

export interface RenderMermaidOptions {
  inputPath: string;
  outputDir: string;
}

export interface RenderMermaidResult {
  svgPath: string;
  svg: string;
}

export async function renderMermaidToSvg(
  options: RenderMermaidOptions
): Promise<RenderMermaidResult> {
  const outputName = basename(options.inputPath).replace(/\.mmd$/, ".svg");
  const svgPath = join(options.outputDir, outputName);

  // Create a temporary directory for the puppeteer config file
  const tempDir = mkdtempSync(join(tmpdir(), "mmdc-config-"));
  const puppeteerConfigPath = join(tempDir, "puppeteer-config.json");
  writeFileSync(puppeteerConfigPath, JSON.stringify({ args: ["--no-sandbox"] }));

  try {
    await execa("npx", [
      "mmdc",
      "-i",
      options.inputPath,
      "-o",
      svgPath,
      "--puppeteerConfigFile",
      puppeteerConfigPath,
    ]);

    const svg = readFileSync(svgPath, "utf-8");
    return { svgPath, svg };
  } finally {
    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  }
}
