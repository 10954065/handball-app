import { z } from 'zod'

/** The version of the messages between HMMS and the vision service. See ai-vision/hmms_vision. */
export const VISION_PROTOCOL = 1

export type VisionState = 'stopped' | 'starting' | 'running' | 'restarting' | 'failed' | 'not_installed'

export const visionHealthSchema = z.object({
  cpuPercent: z.number(),
  memoryUsedMb: z.number(),
  memoryTotalMb: z.number(),
  serviceMemoryMb: z.number(),
  cameras: z.record(z.string(), z.object({ inputFps: z.number() })).default({})
})
export type VisionHealth = z.infer<typeof visionHealthSchema>

export interface VisionStatus {
  state: VisionState
  /** What the operator should know. Null when there is nothing to say. */
  message: string | null
  version: string | null
  restarts: number
  health: VisionHealth | null
}

export const helloSchema = z.object({ type: z.literal('hello'), protocol: z.number(), version: z.string().max(40), python: z.string().max(40) })

export const replySchema = z.discriminatedUnion('ok', [
  z.object({ type: z.literal('reply'), id: z.number(), ok: z.literal(true), data: z.unknown() }),
  z.object({ type: z.literal('reply'), id: z.number(), ok: z.literal(false), error: z.string().max(500) })
])

export const CAMERA_KINDS = ['usb', 'ip', 'phone', 'file'] as const
export type CameraKind = (typeof CAMERA_KINDS)[number]

export const CAMERA_ROLES = ['main', 'goal', 'sideline', 'other'] as const
export type CameraRole = (typeof CAMERA_ROLES)[number]

export const CAMERA_KIND_LABELS: Record<CameraKind, string> = { usb: 'USB webcam', ip: 'Network camera', phone: 'Phone camera', file: 'Video file' }
export const CAMERA_ROLE_LABELS: Record<CameraRole, string> = { main: 'Main sideline', goal: 'Goal-facing', sideline: 'Opposite sideline', other: 'Other' }

export const MAX_CAMERA_SIDE = 7680
export const MAX_CAMERA_FPS = 120

export interface CameraDTO {
  id: string
  name: string
  kind: CameraKind
  source: string
  username: string | null
  /** The password itself never leaves the main process. */
  hasPassword: boolean
  width: number | null
  height: number | null
  fps: number | null
  role: CameraRole
}

export interface UsbDevice {
  index: number
  name: string
}
export const usbDevicesSchema = z.array(z.object({ index: z.number().int().min(0), name: z.string().max(200) }))

/** How the service opens a camera. A network source may hold a password. */
export interface CameraSpec {
  id: string
  kind: 'usb' | 'network' | 'file'
  source: string | number
  width: number | null
  height: number | null
  fps: number | null
}

export const FEED_STATES = ['connecting', 'live', 'reconnecting', 'ended', 'failed', 'closed'] as const
export type FeedState = (typeof FEED_STATES)[number]

export interface CameraFeedDTO {
  id: string
  state: FeedState
  message: string | null
  width: number | null
  height: number | null
}

export const frameEventSchema = z.object({ type: z.literal('frame'), camera: z.string(), seq: z.number(), width: z.number(), height: z.number() })

export const cameraEventSchema = z.object({
  type: z.literal('camera'),
  camera: z.string(),
  state: z.enum(FEED_STATES),
  message: z.string().max(300).nullable(),
  width: z.number().optional(),
  height: z.number().optional()
})

export const ANALYSIS_STATES = ['stopped', 'loading', 'running', 'paused', 'failed'] as const
export type AnalysisState = (typeof ANALYSIS_STATES)[number]

export interface AnalysisDTO {
  state: AnalysisState
  message: string | null
  /** 'Graphics card' or 'Processor': what is actually in use. */
  backend: string | null
  fps: number
  inferenceMs: number
  dropped: number
  tracked: number
  /** How many of those carry a shirt number that has been read and agreed. */
  named: number
}

export const analysisEventSchema = z.object({
  type: z.literal('analysis'),
  state: z.enum(ANALYSIS_STATES),
  message: z.string().max(300).nullable(),
  backend: z.string().max(40).nullable()
})

/**
 * A tracking number is a temporary identity. It is never a player. Role comes from the shirt.
 * The shirt number is one from the team sheet that several frames agreed on, or null.
 */
export const trackSchema = z.object({
  id: z.number(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  score: z.number(),
  role: z.enum(['a', 'b', 'official']).nullable(),
  number: z.number().int().nullable().default(null)
})
export type TrackDTO = z.infer<typeof trackSchema>

export const tracksEventSchema = z.object({
  type: z.literal('tracks'),
  camera: z.string(),
  seq: z.number(),
  width: z.number(),
  height: z.number(),
  tracks: z.array(trackSchema).max(100),
  fps: z.number(),
  inferenceMs: z.number(),
  dropped: z.number()
})

export interface CameraTracksDTO {
  camera: string
  width: number
  height: number
  tracks: TrackDTO[]
}

export const visionModelSchema = z.object({
  key: z.string(),
  name: z.string(),
  version: z.string(),
  sizeMb: z.number(),
  license: z.string(),
  source: z.string(),
  purpose: z.string(),
  installed: z.boolean()
})
export type VisionModelDTO = z.infer<typeof visionModelSchema>

export const SHIRT_SLOTS = ['a', 'b', 'official', 'keeperA', 'keeperB', 'shortsA', 'shortsB'] as const
export type ShirtSlot = (typeof SHIRT_SLOTS)[number]
export const SHIRT_LABELS: Record<ShirtSlot, string> = { a: 'Team A', b: 'Team B', official: 'Officials', keeperA: 'Team A goalkeeper', keeperB: 'Team B goalkeeper', shortsA: 'Team A shorts', shortsB: 'Team B shorts' }
export const shirtsSchema = z.partialRecord(z.enum(SHIRT_SLOTS), z.string().regex(/^#[0-9a-f]{6}$/i))
export type ShirtsDTO = z.infer<typeof shirtsSchema>

export interface SheetPlayerDTO {
  number: number
  name: string
}

export interface SheetTeamDTO {
  name: string
  players: SheetPlayerDTO[]
}

/** The players a camera can name. Team A is the home side and Team B the away side. */
export interface TeamSheetDTO {
  matchId: string
  a: SheetTeamDTO
  b: SheetTeamDTO
}

/** All the service is told. Names stay in the main process. */
export const sheetNumbers = (sheet: TeamSheetDTO) => ({ a: sheet.a.players.map((p) => p.number), b: sheet.b.players.map((p) => p.number) })

export function shirtLabels(sheet: TeamSheetDTO | null | undefined): Record<ShirtSlot, string> {
  if (!sheet) return SHIRT_LABELS
  return { ...SHIRT_LABELS, a: sheet.a.name, b: sheet.b.name, keeperA: `${sheet.a.name} goalkeeper`, keeperB: `${sheet.b.name} goalkeeper`, shortsA: `${sheet.a.name} shorts`, shortsB: `${sheet.b.name} shorts` }
}

/** What to call someone on the picture. A name appears only when their number is on the sheet. */
export function personLabel(track: Pick<TrackDTO, 'role' | 'number'>, sheet: TeamSheetDTO | null | undefined): string {
  if (track.role === 'official') return 'Official'
  if (!track.role) return 'Player'
  const team = shirtLabels(sheet)[track.role]
  if (track.number === null) return team
  const player = sheet?.[track.role].players.find((p) => p.number === track.number)
  return player ? `${player.number} ${player.name}` : `${team} ${track.number}`
}
