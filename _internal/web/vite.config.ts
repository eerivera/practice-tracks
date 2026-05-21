import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Set by CI when building for GitHub Pages (e.g. '/practice-tracks/').
  // Defaults to '/' for local dev and server-mode builds.
  base: process.env['VITE_BASE'] ?? '/',
  // Proxy API and SSE requests to the Express server during development
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      '@common': path.resolve(__dirname, '../common'),
    },
  },
  // Build-time flag: 'server' (default) or 'browser' (static deploy)
  define: {
    'import.meta.env.VITE_BACKEND': JSON.stringify(
      process.env['VITE_BACKEND'] ?? 'server'
    ),
  },
});
