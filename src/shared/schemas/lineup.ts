import { z } from 'zod'
import { TEAM_OFFICIAL_SLOTS } from '../domain/constants'

const uuid = z.string().uuid()

export const lineupEntrySchema = z.object({
  playerId: uuid,
  jerseyNumber: z.number().int().min(1).max(99),
  isStarting: z.boolean(),
  isStartingGk: z.boolean(),
  isCaptain: z.boolean()
})

export const teamOfficialInputSchema = z.object({
  slot: z.enum(TEAM_OFFICIAL_SLOTS),
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().min(1).max(40)
})

export const saveLineupSchema = z.object({
  matchId: uuid,
  side: z.enum(['home', 'away']),
  entries: z.array(lineupEntrySchema).max(20),
  officials: z.array(teamOfficialInputSchema).max(6)
})

export const sideInputSchema = z.object({ matchId: uuid, side: z.enum(['home', 'away']) })
