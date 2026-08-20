import { existsSync, statSync } from "node:fs";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { bundle } from "@remotion/bundler";
import { describe, expect, it } from "vitest";

describe("Cuecast composition render", () => {
  it("renders the hand-written fixture video end to end", async () => {
    // test/fixtures/render-proof-video.svg is a durable, checked-in fixture
    // (generated once from generic-container.mmd via renderMermaidToSvg and
    // committed) — Root.tsx depends on it existing in git regardless of
    // whether this test has run, so this test does not regenerate it.

    const bundleLocation = await bundle({
      entryPoint: "src/remotion/Root.tsx",
      // Remotion's default webpack config resolves an explicit ".js" import
      // literally (it only probes .ts/.tsx for extensionless imports), so it
      // can't find our TS-ESM-style "./Foo.js" imports that actually point at
      // "./Foo.tsx" source files. `extensionAlias` (webpack 5) makes ".js"
      // fall back to .ts/.tsx, matching how tsc + vitest already resolve
      // these same imports elsewhere in this repo.
      //
      // Second problem: Root.tsx needs the checked-in fixture SVG's raw text
      // (to embed in the composition's `defaultProps`), but Root.tsx is
      // bundled for and executed inside the headless browser Remotion
      // renders with — `node:fs` isn't available there. Remotion's default
      // rule for `.svg` is `type: "asset/resource"` (returns a URL string,
      // for `<img src>` use), not the raw markup we need for
      // `dangerouslySetInnerHTML`. Add a `?raw`-suffixed import convention
      // (`asset/source`, returns the file's text content inline at bundle
      // time) and exclude `?raw` imports from the default asset/resource
      // rule so the two don't both claim the same module.
      webpackOverride: (config) => {
        const rules = (config.module?.rules ?? []).map((rule) => {
          if (
            rule &&
            typeof rule === "object" &&
            rule.type === "asset/resource"
          ) {
            return { ...rule, resourceQuery: { not: [/raw/] } };
          }
          return rule;
        });

        return {
          ...config,
          resolve: {
            ...config.resolve,
            extensionAlias: {
              ".js": [".js", ".ts", ".tsx"],
            },
          },
          module: {
            ...config.module,
            rules: [{ resourceQuery: /raw/, type: "asset/source" }, ...rules],
          },
        };
      },
    });
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "Cuecast",
    });

    const outputLocation = "out/render-proof.mp4";
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation,
    });

    expect(existsSync(outputLocation)).toBe(true);
    expect(statSync(outputLocation).size).toBeGreaterThan(0);
  });
}, 120_000);
