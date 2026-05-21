import type { ProgressEvent } from '../types.js';

// Mimics the EventSource interface used by App.tsx's openSse helper, but driven
// by BrowserApi callbacks rather than an HTTP SSE connection.
export class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  dispatch(event: ProgressEvent): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
  }

  error(): void {
    this.onerror?.(new Event('error'));
  }

  // No-op: nothing to close in browser mode.
  close(): void { /* no server connection */ }
}
