import type { WebpackOverrideFn } from "@remotion/bundler";

// Shared by scripts/render-video.ts and test/render/composition.render.test.ts.
//
// Remotion's default webpack config resolves an explicit ".js" import
// literally (it only probes .ts/.tsx for extensionless imports), so it
// can't find our TS-ESM-style "./Foo.js" imports that actually point at
// "./Foo.tsx" source files. `extensionAlias` (webpack 5) makes ".js" fall
// back to .ts/.tsx, matching how tsc + vitest already resolve these same
// imports elsewhere in this repo.
//
// Second problem: Root.tsx needs a checked-in fixture SVG's raw text
// (embedded in its `defaultProps` for the "Cuecast" composition's default),
// but Root.tsx is bundled for and executed inside the headless browser
// Remotion renders with — `node:fs` isn't available there. Remotion's
// default rule for `.svg` is `type: "asset/resource"` (returns a URL
// string, for `<img src>` use), not the raw markup we need for
// `dangerouslySetInnerHTML`. Add a `?raw`-suffixed import convention
// (`asset/source`, returns the file's text content inline at bundle time),
// scoped to `.svg` files so it doesn't silently claim a future `?raw`
// import on an unrelated file type, and exclude `?raw` imports from the
// default asset/resource rule so the two don't both claim the same module.
export const cuecastWebpackOverride: WebpackOverrideFn = (config) => {
  const rules = (config.module?.rules ?? []).map((rule) => {
    if (rule && typeof rule === "object" && rule.type === "asset/resource") {
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
      rules: [
        { test: /\.svg$/, resourceQuery: /raw/, type: "asset/source" },
        ...rules,
      ],
    },
  };
};
