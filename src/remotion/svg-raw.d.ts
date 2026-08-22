// `?raw` imports are resolved to the file's raw text content by a webpack
// `resourceQuery`/`asset-source` rule added in test/render/composition.render.test.ts's
// `webpackOverride` (see that file for why: Root.tsx runs inside the
// browser Remotion renders in, so it cannot use `node:fs` — a build-time raw
// text import is the browser-compatible equivalent of the file read the
// brief originally specified).
declare module "*.svg?raw" {
  const content: string;
  export default content;
}
