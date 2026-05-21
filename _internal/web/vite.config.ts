import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Copies @ffmpeg/core WASM files from node_modules into public/ at the start
// of every browser-mode build or dev server. Files are gitignored — this keeps
// them in sync with whatever @ffmpeg/core version npm has installed.
function ffmpegCorePlugin(): Plugin {
  return {
    name: 'ffmpeg-core',
    buildStart() {
      if (process.env['VITE_BACKEND'] !== 'browser') return;
      const require = createRequire(import.meta.url);
      const coreDir = path.dirname(require.resolve('@ffmpeg/core'));
      const dest = path.resolve(__dirname, 'public');
      mkdirSync(dest, { recursive: true });
      for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
        copyFileSync(path.join(coreDir, file), path.join(dest, file));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), ffmpegCorePlugin()],
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
