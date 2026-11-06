import { protocol } from 'electron'
import type { AppContext } from './context'
import { readMedia } from './services/media'
import type { CameraFeeds } from './vision/feeds'

export const MEDIA_SCHEME = 'hmms-media'
export const VISION_SCHEME = 'hmms-vision'
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Must run before app.whenReady(). */
export function registerMediaScheme(): void {
  const privileges = { standard: true, secure: true, supportFetchAPI: true }
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges }, { scheme: VISION_SCHEME, privileges }])
}

/** Serve a camera's newest picture: hmms-vision://frame/<uuid>. Only to a signed-in user. */
export function handleVisionProtocol(app: AppContext, feeds: CameraFeeds): void {
  protocol.handle(VISION_SCHEME, (req) => {
    const id = new URL(req.url).pathname.replace(/^\//, '')
    const jpeg = app.session && ID.test(id) ? feeds.latest(id) : null
    if (!jpeg) return new Response('Not found', { status: 404 })
    return new Response(new Uint8Array(jpeg), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } })
  })
}

/** Serve images stored in the database: hmms-media://img/<uuid>. Media rows are immutable. */
export function handleMediaProtocol(app: AppContext): void {
  protocol.handle(MEDIA_SCHEME, (req) => {
    const id = new URL(req.url).pathname.replace(/^\//, '')
    if (!ID.test(id)) return new Response('Not found', { status: 404 })
    const m = readMedia(app, id)
    if (!m) return new Response('Not found', { status: 404 })
    return new Response(new Uint8Array(m.bytes), { headers: { 'content-type': m.mime, 'cache-control': 'max-age=31536000, immutable' } })
  })
}
