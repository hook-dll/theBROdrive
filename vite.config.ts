import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

/**
 * LAN access, and why one of the two servers speaks HTTPS.
 *
 * `host: true` binds to every interface instead of localhost, so anything on the
 * same network can open the game at the "Network:" URL vite prints on startup. The
 * game is single-player: every device that connects runs its own world with its own
 * save. What is shared is determinism — the same seed gives the same road, terrain
 * and props everywhere.
 *
 * HTTPS is not a nicety here, it is what makes a phone playable. Motion sensors
 * (`deviceorientation`, and every modern replacement for it) are only delivered to a
 * SECURE CONTEXT. `localhost` counts as one; `http://192.168.x.x` does not. So on a
 * phone opened over plain LAN HTTP the accelerometer stays silent, with no error and
 * no permission prompt — which is exactly how tilt steering "does not work at all"
 * while everything else on the page behaves. `npm run dev` therefore serves HTTPS
 * with a self-signed certificate: the phone shows a one-time "not private" warning,
 * you accept it, and the sensor starts reporting.
 *
 * `npm run dev:http` is the plain-HTTP escape hatch for desktop work, where
 * localhost is already a secure context and a certificate warning is pure friction.
 *
 * `allowedHosts` is a suffix list rather than `true`: vite rejects requests carrying
 * an unexpected Host header, which is what stops a hostile page from pointing a
 * hostname it controls at this dev server and reading the response. Bare IPs are
 * always allowed, so the printed URLs work as-is.
 */
export default defineConfig(({ mode }) => ({
  // `--mode http` (npm run dev:http) is the only way to get a plain server; the
  // default is HTTPS so that a phone on the LAN gets a secure context, and therefore
  // an accelerometer, without anyone having to remember a flag.
  plugins: mode === 'http' ? [] : [basicSsl()],
  server: { host: true, port: 5173, allowedHosts: ['.local', '.lan', '.ts.net'] },
  preview: { host: true, port: 4173, allowedHosts: ['.local', '.lan', '.ts.net'] },
  build: { target: 'es2022' },
}));
