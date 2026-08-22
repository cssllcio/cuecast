# Mermaid addressability spike — findings

Diagram used: `test/fixtures/generic-container.mmd` (generic C4Container, 1 person, 2 containers, 2 rels).

Source:

```
C4Container
title Example System Container Diagram

Person(user, "User")
System_Boundary(sys, "Example System") {
  Container(api, "API", "Node.js", "Handles requests")
  ContainerDb(db, "Database", "Postgres", "Stores data")
}

Rel(user, api, "Uses", "HTTPS")
Rel(api, db, "Reads/writes", "SQL")
```

Rendered twice via `renderMermaidToSvg` (mmdc under the hood) into two separate
temp output directories, then inspected with `inspectSvgIds`.

## What mmdc's C4 SVG output actually exposes

**Person/Container/ContainerDb nodes get individually-addressable, predictable IDs. Rel edges and the System_Boundary get no id at all — not even a shared group wrapper.**

`inspectSvgIds` against the real rendered SVG returned exactly 11 id'd elements:

```json
[
  { "tag": "svg", "id": "my-svg", "classes": [] },
  { "tag": "symbol", "id": "my-svg-computer", "classes": [] },
  { "tag": "symbol", "id": "my-svg-database", "classes": [] },
  { "tag": "symbol", "id": "my-svg-clock", "classes": [] },
  { "tag": "g", "id": "my-svg-user", "classes": ["node", "c4-shape", "c4-person"] },
  { "tag": "g", "id": "my-svg-api", "classes": ["node", "c4-shape", "c4-container"] },
  { "tag": "g", "id": "my-svg-db", "classes": ["node", "c4-shape", "c4-container_db"] },
  { "tag": "marker", "id": "my-svg-arrowhead", "classes": [] },
  { "tag": "marker", "id": "my-svg-arrowend", "classes": [] },
  { "tag": "marker", "id": "my-svg-crosshead", "classes": [] },
  { "tag": "marker", "id": "my-svg-filled-head", "classes": [] }
]
```

The three `Person`/`Container`/`ContainerDb` shapes each render as a `<g>` with:
- `id="my-svg-<alias>"` — the Mermaid alias (`user`, `api`, `db`) appended to the
  document's `svgId` (`my-svg`, mmdc's hardcoded default when no `--svgId` /
  `-I` flag is passed — see `npx mmdc --help`; it is not derived from the input
  filename or diagram title).
- a predictable class list: `node c4-shape c4-person`, `node c4-shape
  c4-container`, `node c4-shape c4-container_db`.

So the mapping from `Container(api, "API", ...)` in source to an addressable
DOM node is exactly `#my-svg-api` — confirmed by direct inspection, not
inferred.

**Both `Rel(...)` lines get no `id` attribute whatsoever.** Grepping the raw
SVG for the edge geometry directly (outside `inspectSvgIds`, since there is no
`id` to find via `querySelectorAll("[id]")`):

- `Rel(user, api, "Uses", "HTTPS")` renders as a bare
  `<line x1="270.29996283031534" y1="336.178618429428" x2="301.1281164308296"
  y2="549.9463958740234" ... marker-end="url(#my-svg-arrowhead)" .../>`
  wrapped in an attribute-less `<g>` — no `id`, no `class` on either the
  `<line>` or its wrapping `<g>`.
- `Rel(api, db, "Reads/writes", "SQL")` renders as a bare
  `<path fill="none" stroke-width="1" stroke="#444444"
  d="M416,601.6470158733899 Q441,603.8232288360596 516,605.9994417987292"
  marker-end="url(#my-svg-arrowhead)"/>` — again no `id`, no `class`.

The two edges aren't even distinguishable from each other by tag: one is a
`<line>`, the other a `<path>` (mermaid chooses primitive shape per edge
routing), and neither carries any attribute that ties it back to its `Rel`
source line, its label text, or its endpoints. The only way to identify "the
line from `Uses`" in the raw markup is by proximity to the adjacent `<text>`
label element (`<tspan>Uses</tspan>`) — not by any DOM id/class contract.

The `System_Boundary(sys, "Example System")` construct is the same story: it
renders as a bare `<rect ... stroke-dasharray="7.0,7.0"/>` plus a `<text>`
label, both with no `id` and no `class`. The alias `sys` used in the source
does not appear anywhere in the rendered SVG's markup (not as an id, not as a
class, not as a data attribute).

## Stability

Rendered the identical `.mmd` source twice, into two independent temp output
directories (`mkdtempSync` each time), through two separate `mmdc` invocations
(two separate headless-Chrome/puppeteer processes). Compared the two SVG
strings directly:

```
svg1 === svg2   →  true
```

The two renders produced **byte-for-byte identical SVG output**, not just
matching ids. `inspectSvgIds(svg1)` and `inspectSvgIds(svg2)` returned the same
11-element array in the same order. For this fixture there is no layout
randomness, no per-run UUIDs, and no timestamp embedded in the markup — mmdc's
C4 rendering is fully deterministic for a fixed input and fixed `svgId`.

The one caveat: the `my-svg` prefix comes from mmdc's *default* `svgId`, which
is constant only because `renderMermaidToSvg` never passes `--svgId`/`-I`. If
two different diagrams are ever rendered without distinct explicit `svgId`
values, their node ids would collide (`#my-svg-api` in both). That's a
same-run collision risk to design around, not an instability finding — a
given `(source, svgId)` pair reproduces identically.

## Consequence for the schema (Task 4)

Neither of the two drafted options is fully correct — the real granularity is
split by element kind:

- **Person/Container/ContainerDb nodes ARE individually addressable and
  stable.** `revealGroups` can key directly on the Mermaid alias for any
  node-level reveal (e.g. revealing `api` or `db` as a whole shape), exactly
  as the design spec hoped, via `#{svgId}-{alias}` (e.g. `#my-svg-api`).
- **`Rel(...)` edges and `System_Boundary` are NOT addressable at all** — not
  individually, and not even via a shared group-level wrapper with a
  recognizable class. They render as bare, unlabeled `<line>`/`<path>`/`<rect>`
  primitives. `revealGroups` cannot key a Rel-level reveal on any SVG `id` —
  there is nothing in the DOM to select. Achieving per-relationship reveal
  will require either (a) post-processing the SVG to inject ids/classes onto
  edge and boundary elements before Remotion consumes it (e.g. a small
  transform pass keyed on element order / adjacency to node ids, since order
  is stable across renders), or (b) restricting v1 reveal granularity to
  nodes only and deferring per-Rel reveal to a later milestone.

Recommendation for Task 4: define `revealGroups` as a mapping from a reveal-group
name to a set of **node aliases** (`Person`/`Container`/`ContainerDb`) whose
ids are directly selectable post-render. Do not draft a `revealGroups` shape
that assumes individually-selectable `Rel` ids exist in mmdc's stock output —
they don't, as observed. If per-edge reveal is a hard requirement, treat SVG
post-processing (id injection) as a separate follow-up task, not something
Task 8's Remotion composition can rely on out of the box.
