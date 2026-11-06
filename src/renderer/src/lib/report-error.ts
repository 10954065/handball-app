import { call } from './api'

/** Send a screen error to the log file in the main process. */
export function reportError(error: unknown): void {
  const e = error instanceof Error ? error : new Error(String(error))
  call('app.reportError', { message: e.message.slice(0, 2000), stack: e.stack?.slice(0, 8000) ?? null, route: location.hash.slice(0, 300) }).catch((failed: unknown) => {
    // The log cannot be reached, so the console is the only record left.
    console.error('Could not report a screen error', failed, e)
  })
}

/** Errors outside React rendering: event handlers that throw and promises nothing is waiting for. */
export function reportUncaughtErrors(): void {
  window.addEventListener('error', (e) => reportError(e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason))
}
