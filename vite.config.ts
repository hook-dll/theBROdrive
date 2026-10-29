import basicSsl from '@vitejs/plugin-basic-ssl';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Dev only: `POST /__cabin-bake/<name>` writes the body to `public/audio/cabin/<name>.wav`.
 * The car lab's «Записать лупы» renders the cabin loops (src/audio/cabinsynth.ts) in the
 * browser, the only place OfflineAudioContext exists, and posts each one here.
 */
function cabinBake(): Plugin {
  return {
    name: 'cabin-bake',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__cabin-bake/', (req, res) => {
        const name = (req.url ?? '').replace(/^\//, '');
        if (req.method !== 'POST' || !/^[a-z0-9-]+$/.test(name)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const dir = resolve(server.config.root, 'public/audio/cabin');
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `${name}.wav`), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

/**
 * Development and preview servers use plain HTTP by default: the shipped local package
 * serves only on 127.0.0.1, and the headless tools (tools/look) drive http URLs.
 *
 * `npm run dev:https` (`vite --mode https`) serves over a self-signed certificate
 * instead, for a phone on the LAN: `AudioWorklet` — the engines and the limiter — exists
 * only in a secure context, and http://192.168.… is not one. The phone shows a
 * certificate warning once; accept it. A mode rather than an environment variable, so
 * the script runs the same in cmd, PowerShell and a POSIX shell.
 */
export default defineConfig(({ mode }) => ({
  plugins: [cabinBake(), ...(mode === 'https' ? [basicSsl()] : [])],
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
