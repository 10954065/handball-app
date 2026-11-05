export interface HmmsBridge {
  invoke(channel: string, input?: unknown): Promise<unknown>
  on(event: string, listener: (payload: unknown) => void): () => void
}

declare global {
  interface Window {
    hmms: HmmsBridge
  }
}
