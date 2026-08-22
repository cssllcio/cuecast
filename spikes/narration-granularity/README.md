# Narration timestamp granularity — finding

**Status:** Pending real-service verification.

This spike investigates whether the text-to-speech `/transcribe` endpoint returns word-level timestamps (a populated `words` array per segment) or segment-level timestamps only (`words` undefined).

To determine the granularity, run:

```bash
CUECAST_TTS_URL=http://127.0.0.1:17493 CUECAST_TTS_PROFILE_ID=<your-profile> npm run test:integration
```

The test will generate a phrase, transcribe it, and log:
1. Whether word-level timestamps are present
2. The raw JSON response for analysis

**Finding:** [To be filled in after running against a live TTS service]

```json
[Example transcription response to be recorded here]
```

This finding informs whether Task 6's `buildTimingTrack` can use word-level timing for tighter emphasis sync or must rely on segment-level timing. The client implementation stays correct either way.
