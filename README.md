# cuecast

Narration-timed reveal animations from a declarative script. You write a
`video.json` — narration beats and a pointer at a Mermaid diagram already
living in your docs — and cuecast produces a rendered video where every
reveal lands exactly on the line of narration that introduces it.

Status: design only. See [`docs/superpowers/specs/2026-08-20-cuecast-design.md`](docs/superpowers/specs/2026-08-20-cuecast-design.md).

## Why

Conventional explainer-video order is: animate, then cut narration to fit.
Every script edit becomes expensive. cuecast inverts it: narration is
generated and transcribed first, so timing is *extracted*, not authored —
edit the script, rebuild, reveals re-sync automatically.

## Scope

- Consumes a Mermaid C4 diagram already in your docs — no separate diagram
  authoring format. Docs and video can't drift from each other.
- Narration via a local TTS service (generate → transcribe → timing),
  pronunciation handled as orthographic respelling with a mandatory fixture
  test, since these engines have no phoneme tags.
- Render via a code-native compositor (no Illustrator/After Effects
  round-trip).
- Product-agnostic core. Product-specific content — scripts, pronunciation
  overrides, actual diagrams — lives in the consuming product's own repo.

## License

MIT — see [LICENSE](LICENSE).
