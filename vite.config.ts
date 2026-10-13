import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, normalizePath, type Plugin } from 'vite';

const CABIN_CAMERAS_FILE = normalizePath(fileURLToPath(new URL('./config/cabin-cameras.json', import.meta.url)));

/**
 * Dev server only: `POST /__dev/cabin-camera` with `{ id, eye: [x, y, z] }` writes one
 * car's driver-camera position into `config/cabin-cameras.json` (J in the game's cabin
 * view; see src/vehicle/cabincamera.ts). Keys sorted, one `"id": [x, y, z]` line per car,
 * trailing newline, so a save diffs as one line.
 *
 * The game imports that file, so a write would normally be an HMR update with no boundary
 * to stop it and reload the page under the player mid-tune. The game already holds the
 * saved value; the file is for the next load. So the hot update for this one file is
 * dropped.
 */
function cabinCameraWriter(): Plugin {
  return {
    name: 'bro-cabin-camera-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/cabin-camera', (req, res) => {
        const reply = (status: number, body: unknown): void => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return reply(405, { error: 'POST only' });
        let raw = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => (raw += chunk));
        req.on('end', () => {
          try {
            const { id, eye } = JSON.parse(raw) as { id?: unknown; eye?: unknown };
            if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('bad id');
            if (!Array.isArray(eye) || eye.length !== 3 || !eye.every((v) => typeof v === 'number' && Number.isFinite(v))) {
              throw new Error('eye must be three finite numbers');
            }
            const table = JSON.parse(readFileSync(CABIN_CAMERAS_FILE, 'utf8')) as Record<string, unknown>;
            table[id] = (eye as number[]).map((v) => Math.round(v * 1000) / 1000);
            // One car per line, `"id": [x, y, z]`, so a save is a one-line diff.
            const lines = Object.keys(table)
              .sort()
              .map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(table[key]).replaceAll(',', ', ')}`);
            writeFileSync(CABIN_CAMERAS_FILE, lines.length === 0 ? '{}\n' : `{\n${lines.join(',\n')}\n}\n`);
            reply(200, { ok: true });
          } catch (error) {
            reply(400, { error: error instanceof Error ? error.message : String(error) });
          }
        });
      });
    },
    hotUpdate({ file }) {
      if (file === CABIN_CAMERAS_FILE) return [];
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
  plugins: [cabinCameraWriter(), ...(mode === 'https' ? [basicSsl()] : [])],
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
