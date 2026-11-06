import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { AppError } from '@shared/errors'
import type { cameraInputSchema, cameraUpdateSchema } from '@shared/schemas/vision'
import type { CameraDTO, CameraSpec, UsbDevice } from '@shared/vision'
import { cameraDevices } from '../db/schema'
import { audit } from './audit'
import { type Ctx, notFound, nowOf, tx, uuid } from './ctx'

/** Encryption tied to this Windows account. Passed in, so this file stays free of Electron. */
export interface Secrets {
  available: () => boolean
  encrypt: (text: string) => string
  decrypt: (text: string) => string
}

type Row = typeof cameraDevices.$inferSelect

function toDTO(r: Row): CameraDTO {
  return { id: r.id, name: r.name, kind: r.kind, source: r.source, username: r.username, hasPassword: !!r.passwordEncrypted, width: r.width, height: r.height, fps: r.fps, role: r.role }
}

const row = (ctx: Ctx, id: string): Row => ctx.db.select().from(cameraDevices).where(eq(cameraDevices.id, id)).get() ?? notFound('Camera')

function seal(secrets: Secrets, password: string): string {
  if (!secrets.available()) throw new AppError('CONFLICT', 'Windows cannot protect a saved password on this account, so it was not stored.')
  return secrets.encrypt(password)
}

export function listCameras(ctx: Ctx): CameraDTO[] {
  return ctx.db.select().from(cameraDevices).orderBy(asc(cameraDevices.name)).all().map(toDTO)
}

export function createCamera(ctx: Ctx, secrets: Secrets, input: z.output<typeof cameraInputSchema>): CameraDTO {
  const { password, ...fields } = input
  const id = uuid()
  const passwordEncrypted = password ? seal(secrets, password) : null
  tx(ctx, () => {
    ctx.db.insert(cameraDevices).values({ ...fields, id, passwordEncrypted, updatedAt: nowOf(ctx) }).run()
    audit(ctx, { action: 'camera.create', entity: 'camera_devices', entityId: id, note: `${fields.name} (${fields.kind})` })
  })
  return toDTO(row(ctx, id))
}

export function updateCamera(ctx: Ctx, secrets: Secrets, input: z.output<typeof cameraUpdateSchema>): CameraDTO {
  const { id, password, ...fields } = input
  const current = row(ctx, id)
  const passwordEncrypted = password === undefined ? current.passwordEncrypted : password === null ? null : seal(secrets, password)
  tx(ctx, () => {
    ctx.db.update(cameraDevices).set({ ...fields, passwordEncrypted, updatedAt: nowOf(ctx) }).where(eq(cameraDevices.id, id)).run()
    audit(ctx, { action: 'camera.update', entity: 'camera_devices', entityId: id, note: `${fields.name} (${fields.kind})` })
  })
  return toDTO(row(ctx, id))
}

export function deleteCamera(ctx: Ctx, id: string): void {
  const current = row(ctx, id)
  tx(ctx, () => {
    ctx.db.delete(cameraDevices).where(eq(cameraDevices.id, id)).run()
    audit(ctx, { action: 'camera.delete', entity: 'camera_devices', entityId: id, note: current.name })
  })
}

function streamAddress(secrets: Secrets, r: Row): string {
  if (!r.username && !r.passwordEncrypted) return r.source
  let password = ''
  if (r.passwordEncrypted) {
    try {
      password = secrets.decrypt(r.passwordEncrypted)
    } catch {
      throw new AppError('CONFLICT', `The password for ${r.name} was saved on another Windows account. Enter the camera password again.`)
    }
  }
  // Written by hand: URL's setters leave some of these characters as they are.
  const scheme = r.source.indexOf('://') + 3
  const credentials = `${encodeURIComponent(r.username ?? '')}:${encodeURIComponent(password)}`
  return `${r.source.slice(0, scheme)}${credentials}@${r.source.slice(scheme)}`
}

/** What the service needs to open a camera. It holds the password, so it is never logged or stored. */
export function cameraSpec(ctx: Ctx, secrets: Secrets, id: string, devices: readonly UsbDevice[]): CameraSpec {
  const r = row(ctx, id)
  const size = { width: r.width, height: r.height, fps: r.fps }
  if (r.kind === 'usb') {
    const device = devices.find((d) => d.name === r.source)
    if (!device) throw new AppError('CONFLICT', `${r.source} is not connected.`)
    return { id, kind: 'usb', source: device.index, ...size }
  }
  if (r.kind === 'file') return { id, kind: 'file', source: r.source, ...size }
  return { id, kind: 'network', source: streamAddress(secrets, r), ...size }
}
