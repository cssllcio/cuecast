import type { Cue } from "./cues.js";

/**
 * Seconds to a caption timestamp.
 *
 * This lives here rather than in src/timing/frames.ts deliberately. That file
 * asks any new seconds conversion to justify itself, and its two conversions
 * are both to *frames*; this one is to milliseconds, for a text format that
 * knows nothing about fps. Adding it there would make "the only two
 * conversions" false without making anything simpler.
 *
 * Rounds rather than truncates. buildTimingTrack accumulates
 * `cursorSeconds = entry.endSeconds`, so a real span can arrive as
 * 8.699999999999998, which truncation would render as 08.699.
 */
function formatTimestamp(seconds: number, msSeparator: string): string {
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = (totalMs - ms) / 1000;
  const s = totalSeconds % 60;
  const totalMinutes = (totalSeconds - s) / 60;
  const m = totalMinutes % 60;
  const h = (totalMinutes - m) / 60;

  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${msSeparator}${pad(ms, 3)}`;
}

/**
 * Drops blank lines from cue text.
 *
 * Both WebVTT and SRT delimit cue blocks with a blank line, so a blank line
 * *inside* a cue's text ends that cue's block early — everything after it
 * gets reprocessed as if it were the start of the next block, which
 * typically fails to parse as a timing line and is silently discarded,
 * taking the rest of the file down with it (verified against a real parser:
 * two cues in, one cue out, no error). Filtering out empty lines rather
 * than e.g. joining them with a space keeps any line breaks the author
 * wrote on purpose — cue text can still span multiple lines, just never a
 * blank one.
 */
function stripBlankLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Escapes cue text for WebVTT, whose cue payload is a small tag language,
 * not plain text.
 *
 * `&`, `<` and `>` become WebVTT's own escapes (`&amp;`, `&lt;`, `&gt;`).
 * Without this, `<track>` in cue text tokenises as a start tag (with an
 * unrecognised name, so it's dropped) rather than four literal characters,
 * and a bare `&` can begin a malformed character reference — either way,
 * what the viewer reads stops matching what the author wrote, which is
 * exactly the failure the `text`/`spoken` split exists to prevent
 * elsewhere.
 *
 * Escaping `>` also happens to solve a second, unrelated problem: per the
 * WebVTT parsing algorithm, any line containing the literal substring
 * `-->` while a cue's text is being collected ends that cue immediately and
 * gets reprocessed as the next cue's timing line, where it fails and is
 * dropped — so a browser's `<track>` silently loses that caption. cuecast
 * narrates mermaid diagrams, where `-->` is ordinary edge syntax ("the
 * arrow from A to B, `A --> B`"), so this is not a contrived input for this
 * project. Once every `>` reads as `&gt;`, the three-character sequence
 * `-->` no longer occurs anywhere in the emitted text, so escaping `>` for
 * tag-safety incidentally fixes this too.
 *
 * `&` must be escaped first — escaping `<`/`>` before it would double-escape
 * the ampersands those substitutions introduce (`<` → `&lt;` contains `&`).
 */
function escapeVttText(text: string): string {
  return stripBlankLines(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * SRT has no tag language and no standardised entity escaping — most
 * players show `&lt;` as those four literal characters rather than
 * decoding it, so applying WebVTT's escaping here would corrupt plain text
 * instead of protecting it. SRT cue blocks are still blank-line-delimited
 * like VTT's, though, so the blank-line corruption above applies equally
 * and still needs fixing.
 */
function escapeSrtText(text: string): string {
  return stripBlankLines(text);
}

/** WebVTT: a header, then blank-line-separated cues with `.` before the ms. */
export function formatVtt(cues: Cue[]): string {
  const blocks = cues.map(
    (cue) =>
      `${formatTimestamp(cue.startSeconds, ".")} --> ${formatTimestamp(cue.endSeconds, ".")}\n` +
      `${escapeVttText(cue.text)}\n`
  );
  return `WEBVTT\n${blocks.map((block) => `\n${block}`).join("")}`;
}

/** SRT: no header, 1-based indices, `,` before the ms. */
export function formatSrt(cues: Cue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n` +
        `${formatTimestamp(cue.startSeconds, ",")} --> ${formatTimestamp(cue.endSeconds, ",")}\n` +
        `${escapeSrtText(cue.text)}\n`
    )
    .join("\n");
}
