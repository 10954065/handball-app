import { z } from 'zod'
import { SHOT_OUTCOMES, SHOT_SITUATIONS, SHOT_ZONES } from '../domain/constants'

const id = z.string().uuid()
const side = z.enum(['home', 'away'])
const reason = z.string().trim().min(3, 'Give a reason (at least 3 characters).').max(300)

export const matchRef = z.object({ matchId: id })

export const eventDraftSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('shot'),
    side,
    rosterId: id,
    outcome: z.enum(SHOT_OUTCOMES),
    situation: z.enum(SHOT_SITUATIONS),
    zone: z.enum(SHOT_ZONES).nullable().default(null),
    assistRosterId: id.nullable().default(null),
    goalkeeperRosterId: id.nullable().optional()
  }),
  z.object({ kind: z.enum(['technical_fault', 'turnover', 'steal', 'block']), side, rosterId: id.nullable().default(null) }),
  z.object({ kind: z.literal('substitution'), side, outRosterId: id.nullable(), inRosterId: id.nullable() }),
  z.object({ kind: z.literal('note'), side: side.nullable().default(null), text: z.string().trim().min(1).max(500) })
])

/** Idempotent: a repeated clientRequestId returns the current state without recording twice. */
export const recordEventSchema = z.object({ matchId: id, clientRequestId: id, event: eventDraftSchema })

/** Replace an event: the original is voided and a corrected copy is recorded, both audited. */
export const editEventSchema = z.object({
  matchId: id,
  eventId: id,
  event: eventDraftSchema,
  /** Corrected match time; defaults to the original time. */
  matchMs: z.number().int().min(0).max(12 * 3_600_000).optional(),
  reason
})

export const voidEventSchema = z.object({ matchId: id, eventId: id, reason })

export const clockActionSchema = z.object({ matchId: id, action: z.enum(['start', 'stop']) })
export const setClockSchema = z.object({ matchId: id, ms: z.number().int().min(0).max(12 * 3_600_000), reason })
export const recoverClockSchema = z.object({ matchId: id, resumeAtMs: z.number().int().min(0).max(12 * 3_600_000) })
export const endPeriodSchema = z.object({ matchId: id, force: z.boolean().default(false) })
export const finishMatchSchema = z.object({ matchId: id, force: z.boolean().default(false) })

export const sanctionSchema = z.object({
  matchId: id,
  clientRequestId: id,
  kind: z.enum(['warning', 'suspension', 'disqualification']),
  side,
  target: z.discriminatedUnion('type', [
    z.object({ type: z.literal('player'), rosterId: id }),
    z.object({ type: z.literal('official'), teamOfficialId: id })
  ]),
  blueCard: z.boolean().default(false),
  reason: z.string().trim().max(300).optional(),
  /** The operator has seen the rule warnings and the referees' decision stands. */
  acknowledged: z.boolean().default(false)
})

export const startTimeoutSchema = z.object({ matchId: id, clientRequestId: id, side })
