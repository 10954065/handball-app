import { eq } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import { media } from '../db/schema'
import { type Ctx, nowOf, uuid } from './ctx'

const MAX_BYTES = 2 * 1024 * 1024

/** Magic-number check so only real PNG/JPEG/WebP images are stored. */
function sniff(buf: Buffer): string | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

export function saveMedia(ctx: Ctx, input: { mime: string; base64: string; width?: number; height?: number }): { id: string } {
  const bytes = Buffer.from(input.base64, 'base64')
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new AppError('VALIDATION', 'Images must be smaller than 2 MB.')
  const detected = sniff(bytes)
  if (!detected || detected !== input.mime) throw new AppError('VALIDATION', 'Only PNG, JPEG or WebP images are supported.')
  const id = uuid()
  ctx.db.insert(media).values({ id, mime: detected, bytes, width: input.width ?? null, height: input.height ?? null, createdAt: nowOf(ctx) }).run()
  return { id }
}

export function readMedia(ctx: Pick<Ctx, 'db'>, id: string): { mime: string; bytes: Buffer } | null {
  const row = ctx.db.select({ mime: media.mime, bytes: media.bytes }).from(media).where(eq(media.id, id)).get()
  return row ? { mime: row.mime, bytes: row.bytes as Buffer } : null
}
