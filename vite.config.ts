import { defineConfig } from 'vite';

/**
 * Development and preview servers intentionally use plain HTTP. The shipped local
 * package serves only on 127.0.0.1, and touch steering is an on-screen slider, so
 * neither a certificate nor device-motion permissions are required.
 */
export default defineConfig(() => ({
  server: { host: true, port: 5173, allowedHosts: ['.local', '.lan', '.ts.net'] },
  preview: { host: true, port: 4173, allowedHosts: ['.local', '.lan', '.ts.net'] },
  build: { target: 'es2022' },
}));
