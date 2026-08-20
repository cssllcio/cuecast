import { describe, expect, it } from "vitest";
import { inspectSvgIds } from "./inspectSvgIds.js";

describe("inspectSvgIds", () => {
  it("extracts every id'd element from an SVG document", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g id="person1" class="person"><rect /></g>
      <g id="rel-user-api" class="relationship"><line /></g>
      <g class="unlabeled"><rect /></g>
    </svg>`;

    const ids = inspectSvgIds(svg);

    expect(ids).toEqual([
      { tag: "g", id: "person1", classes: ["person"] },
      { tag: "g", id: "rel-user-api", classes: ["relationship"] },
    ]);
  });
});
