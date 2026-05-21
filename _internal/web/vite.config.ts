import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Proxy API and SSE requests to the Express server during development
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  // Build-time flag: 'server' (default) or 'browser' (future static deploy)
  define: {
    'import.meta.env.VITE_BACKEND': JSON.stringify(
      process.env['VITE_BACKEND'] ?? 'server'
    ),
  },
});
