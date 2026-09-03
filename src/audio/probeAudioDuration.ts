import { parseFile } from "music-metadata";

// A bed beat's real duration comes from its audio asset, not from anything
// authored in video.json — probed here, once, before buildTimingTrack lays
// out the timeline (see src/pipeline/renderVideo.ts).
export async function probeAudioDurationSeconds(
  filePath: string
): Promise<number> {
  const metadata = await parseFile(filePath);
  const duration = metadata.format.duration;
  if (duration === undefined) {
    throw new Error(`could not determine duration for audio file: ${filePath}`);
  }
  return duration;
}
