import { JSDOM } from "jsdom";

export interface SvgElementId {
  tag: string;
  id: string;
  classes: string[];
}

export function inspectSvgIds(svgContent: string): SvgElementId[] {
  const dom = new JSDOM(svgContent, { contentType: "image/svg+xml" });
  const elements = Array.from(
    dom.window.document.querySelectorAll("[id]")
  );

  return elements.map((el) => ({
    tag: el.tagName.toLowerCase(),
    id: el.getAttribute("id") ?? "",
    classes: el.getAttribute("class")?.split(/\s+/).filter(Boolean) ?? [],
  }));
}
