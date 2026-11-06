import { z } from 'zod'

/** The version of the messages between HMMS and the vision service. See ai-vision/hmms_vision. */
export const VISION_PROTOCOL = 1

export type VisionState = 'stopped' | 'starting' | 'running' | 'restarting' | 'failed' | 'not_installed'

export const visionHealthSchema = z.object({
  cpuPercent: z.number(),
  memoryUsedMb: z.number(),
  memoryTotalMb: z.number(),
  serviceMemoryMb: z.number()
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
