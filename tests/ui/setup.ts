import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

/** Mock of the preload bridge. Tests set window.hmms.invoke responses per channel. */
export const invoke = vi.fn(async (_channel: string, _input?: unknown): Promise<unknown> => ({ ok: true, data: null }))

Object.defineProperty(window, 'hmms', {
  value: { invoke, on: () => () => undefined },
  writable: true
})

afterEach(() => {
  cleanup()
  invoke.mockReset()
  invoke.mockImplementation(async () => ({ ok: true, data: null }))
})
