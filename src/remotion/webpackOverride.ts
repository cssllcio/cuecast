import type { WebpackOverrideFn } from "@remotion/bundler";

// Shared by src/pipeline/renderVideo.ts and test/render/composition.render.test.ts.
//
// Remotion's default webpack config resolves an explicit ".js" import
// literally (it only probes .ts/.tsx for extensionless imports), so it
// can't find our TS-ESM-style "./Foo.js" imports that actually point at
// "./Foo.tsx" source files. `extensionAlias` (webpack 5) makes ".js" fall
// back to .ts/.tsx, matching how tsc + vitest already resolve these same
// imports elsewhere in this repo.
export const cuecastWebpackOverride: WebpackOverrideFn = (config) => {
  return {
    ...config,
    resolve: {
      ...config.resolve,
      extensionAlias: {
        ".js": [".js", ".ts", ".tsx"],
      },
    },
  };
};
