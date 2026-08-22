# Narration timestamp granularity — finding

**Status:** Resolved 2026-08-22 against a live Voicebox 0.5.0 (`127.0.0.1:17493`).

The design spec (§6) asked whether the TTS service's `/transcribe` endpoint
returns word-level or segment-level timestamps. The answer is **neither**.

## What Voicebox actually returns

`POST /transcribe` (multipart `file` upload; optional `language`, `model`)
returns exactly two fields, verified with a real 200 response:

```json
{"text": "QCAST Health Check after restart. To restart,", "duration": 3.22}
```

No `segments`, no `words`, no offsets of any kind. The MCP surface
(`voicebox.transcribe`) returns the same plus `language` and `model`. The
server log during a call shows only the Whisper model load and the request
line — the backend is `mlx_backend` (mlx-whisper), which computes segments
internally, but Voicebox's API layer discards them and never logs them.

## Consequence for the design

Transcription cannot drive timing, so the pipeline no longer transcribes at
all. The completed `/generate` response already carries `duration`, and it is
exact: a reported `3.22` matched `ffprobe`'s `3.220000` on the fetched WAV.
`buildTimingTrack` takes one `durations` map for narration *and* bed beats;
`NarrationClient.transcribe` and `TranscribeResult` were removed (issue #6).

Beat-level timing is therefore the granularity cuecast has. Tighter,
within-beat emphasis sync would need a different engine or a local forced
aligner — a separate decision, not something to retrofit onto `/transcribe`.

## Why /transcribe was also rejected as a pronunciation check

The idea of keeping `/transcribe` as a warn-only check of `spoken` text was
tested and dropped. Whisper `base` (Voicebox's default) hallucinated ~13
extra words on a 3.2 s clip and was non-deterministic across runs; `turbo`
was far better but still produced `"QCAST"` for *Cuecast* and appended a
phantom phrase. It fails on exactly the coined and domain terms the
pronunciation lexicon exists to protect, so it would false-alarm where it
matters most. The fixture-test procedure (listen by ear) remains the check.

## Reproduce

```bash
CUECAST_TTS_URL=http://127.0.0.1:17493 CUECAST_TTS_PROFILE_ID=<profile> npm run test:integration
```
