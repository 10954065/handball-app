import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/**
 * Secure bridge. The renderer receives exactly two capabilities:
 *  - invoke(channel, input): call a contract channel (validated and authorised in main)
 *  - on(event, listener): subscribe to push events from main
 * No Node.js, filesystem or Electron APIs are exposed.
 */
const CHANNEL = /^[a-z]+(\.[A-Za-z]+)+$/

const api = {
  invoke(channel: string, input?: unknown): Promise<unknown> {
    if (!CHANNEL.test(channel)) return Promise.reject(new Error('Invalid channel'))
    return ipcRenderer.invoke(`hmms:${channel}`, input)
  },
  on(event: string, listener: (payload: unknown) => void): () => void {
    if (!CHANNEL.test(event)) throw new Error('Invalid event')
    const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(`hmms-push:${event}`, wrapped)
    return () => ipcRenderer.removeListener(`hmms-push:${event}`, wrapped)
  }
}

contextBridge.exposeInMainWorld('hmms', api)
