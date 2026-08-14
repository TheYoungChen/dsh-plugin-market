/**
 * Standalone build for an out-of-tree bundle, mirroring the proven
 * dsh-external/plugin-console preset: a Node half (ESM) and a browser half
 * (CJS wrapped in the official `window.__ModuleLoader__.load` contract).
 * No import of the official monorepo preset — resolves cleanly outside the repo.
 */
export default [
  {
    entry: ['src/index.ts'],
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    outDir: 'lib',
    clean: true,
    external: [/@deepseek-ai\//],
  },
  {
    name: 'dsh-plugin-market/client',
    entry: { client: 'src/client/index.ts' },
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    outDir: 'lib',
    dts: false,
    clean: false,
    // Official client contract: the bundle calls window.__ModuleLoader__.load.
    // CJS (ESM output is incompatible with the top-level return). module/exports
    // go in the banner; the footer returns exports.
    external: [/@deepseek-ai\//, /^react($|\/)/],
    outputOptions: {
      entryFileNames: 'index.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-plugin-market", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
      footer: 'return exports; } });',
    },
  },
]
