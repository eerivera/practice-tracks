import type { ProcessingApi } from './interface.js';
import { ServerApi } from './server.js';
import { BrowserApi } from './browser.js';

export function createApi(): ProcessingApi {
  // VITE_BACKEND is set at build time via vite.config.ts define block.
  // 'server' (default) → ServerApi, talks to the local Express server.
  // 'browser' → BrowserApi, runs everything in-browser via WASM (future).
  if ((import.meta.env as { VITE_BACKEND?: string }).VITE_BACKEND === 'browser') {
    return new BrowserApi();
  }
  return new ServerApi();
}
