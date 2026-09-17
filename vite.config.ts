import { defineConfig } from 'vite';

/**
 * Development and preview servers intentionally use plain HTTP. The shipped local
 * package serves only on 127.0.0.1, and touch steering is an on-screen slider, so
 * neither a certificate nor device-motion permissions are required.
 */
export default defineConfig(({ mode }) => ({
  /**
   * `vite build` hardcodes `process.env.NODE_ENV` to `"production"` regardless of
   * `--mode`, so `import.meta.env.DEV` (the flag every dev-menu button and the
   * `window.__bro` debug surface is gated behind) stays false even under
   * `--mode development`. Override the two defines directly from the resolved
   * `mode` instead: a plain `vite build` (mode "production") is untouched, while
   * `vite build --mode development` compiles the dev tooling into an otherwise
   * normal minified/bundled/tree-shaken production build.
   */
  define:
    mode === 'production'
      ? {}
      : { 'import.meta.env.DEV': 'true', 'import.meta.env.PROD': 'false' },
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['.local', '.lan', '.ts.net'],
    /**
     * Raw asset-pack originals get dropped at the repo root (see .gitignore) and are
     * routinely held open by the tools that produced them — OpenIV keeps an exclusive
     * handle on `dlc.rpf`, for instance. Chokidar's `fs.watch` call then throws EBUSY,
     * and the FSWatcher `error` event is fatal: the dev server dies with exit 1 rather
     * than degrading. None of these files are inputs to the bundle, so never watch them.
     */
    watch: { ignored: ['**/*.rpf', '**/*.zip', '**/*.7z', '**/*.rar'] },
  },
  preview: { host: true, port: 4173, allowedHosts: ['.local', '.lan', '.ts.net'] },
  build: { target: 'es2022' },
}));
