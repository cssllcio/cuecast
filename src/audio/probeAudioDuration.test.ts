import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { probeAudioDurationSeconds } from "./probeAudioDuration.js";

// A minimal, valid WAV file: PCM, mono, 8kHz, 8-bit, exactly one second of
// silence (8000 sample bytes). Real audio bytes, not a mock — music-metadata
// parses the actual RIFF/fmt/data structure to derive duration.
function buildOneSecondSilentWav(): Buffer {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 8;
  const dataSize = sampleRate; // 1 second of 8-bit mono samples
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  buffer.fill(0x80, 44); // silence at 8-bit unsigned midpoint

  return buffer;
}

describe("probeAudioDurationSeconds", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cuecast-audio-probe-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the real duration of a WAV file", async () => {
    const filePath = join(dir, "silence.wav");
    writeFileSync(filePath, buildOneSecondSilentWav());

    const duration = await probeAudioDurationSeconds(filePath);

    expect(duration).toBeCloseTo(1.0, 1);
  });
});
