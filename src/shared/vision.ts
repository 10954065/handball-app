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
