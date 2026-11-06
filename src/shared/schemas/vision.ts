import { z } from 'zod'
import { SHOT_OUTCOMES } from '../domain/constants'
import { CAMERA_KINDS, CAMERA_ROLES, MAX_CAMERA_FPS, MAX_CAMERA_SIDE } from '../vision'

const uuid = z.uuid()
const STREAM_PROTOCOLS = ['rtsp:', 'rtsps:', 'http:', 'https:']

function isStreamAddress(text: string): boolean {
  try {
    return STREAM_PROTOCOLS.includes(new URL(text).protocol)
  } catch {
    return false
  }
}

const hasNoCredentials = (text: string) => !new URL(text).username && !new URL(text).password

const cameraFields = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(CAMERA_KINDS),
  source: z.string().trim().min(1).max(500),
  username: z.string().trim().max(100).nullable().default(null),
  width: z.number().int().min(160).max(MAX_CAMERA_SIDE).nullable().default(null),
  height: z.number().int().min(120).max(MAX_CAMERA_SIDE).nullable().default(null),
  fps: z.number().int().min(1).max(MAX_CAMERA_FPS).nullable().default(null),
  role: z.enum(CAMERA_ROLES).default('main')
})

type CameraFields = { kind: (typeof CAMERA_KINDS)[number]; source: string }

function checkSource(camera: CameraFields, ctx: z.RefinementCtx): void {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', path: ['source'], message })
  if (camera.kind === 'ip' || camera.kind === 'phone') {
    if (!isStreamAddress(camera.source)) issue('Enter a stream address starting with rtsp:// or http://.')
    else if (!hasNoCredentials(camera.source)) issue('Put the username and password in their own fields, not in the address.')
  }
  if (camera.kind === 'file' && !/^[a-zA-Z]:[\\/]/.test(camera.source)) issue('Choose a video file.')
}

export const cameraInputSchema = cameraFields.extend({ password: z.string().min(1).max(200).optional() }).superRefine(checkSource)

/** On an edit, leaving the password out keeps it, and null removes it. */
export const cameraUpdateSchema = cameraFields.extend({ id: uuid, password: z.string().min(1).max(200).nullable().optional() }).superRefine(checkSource)

export const cameraRef = z.object({ id: uuid })

/** The match supplies the shirt colours. Without one, players are tracked but no team is estimated. */
export const startAnalysisSchema = z.object({ matchId: uuid.nullable().default(null), rate: z.number().positive().max(30).default(10) })
export const pauseAnalysisSchema = z.object({ paused: z.boolean() })

export const listSuggestionsSchema = z.object({ matchId: uuid, status: z.enum(['pending', 'confirmed', 'rejected', 'corrected', 'expired']).optional() })

/** Anything left out keeps what the suggestion said. */
export const confirmSuggestionSchema = z.object({
  id: uuid,
  side: z.enum(['home', 'away']).nullable().optional(),
  rosterId: uuid.nullable().optional(),
  outcome: z.enum(SHOT_OUTCOMES).optional(),
  matchMs: z.number().int().min(0).max(12 * 3_600_000).optional()
})
export const rejectSuggestionSchema = z.object({ id: uuid, reason: z.string().trim().max(200).nullable().default(null) })
