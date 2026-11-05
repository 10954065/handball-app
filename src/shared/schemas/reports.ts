import { z } from 'zod'
import { MAX_BRACKET_TEAMS } from '../domain/bracket'

const id = z.string().uuid()

/** 1 January 2100: anything later is a typing mistake. */
const MAX_DATE_MS = 4_102_444_800_000
const matchTime = z.number().int().min(0).max(MAX_DATE_MS)

export const statisticsQuery = z.object({ seasonId: id.optional(), competitionId: id.optional(), teamId: id.optional() })

export const reportFormat = z.enum(['pdf', 'xlsx'])
export const generateReportSchema = z.object({ matchId: id, format: reportFormat })
export const reportListQuery = z.object({ matchId: id.optional(), limit: z.number().int().min(1).max(500).default(200) })

export const seasonRef = z.object({ seasonId: id })
export const saveSeasonReportSchema = z.object({ seasonId: id, format: reportFormat })

export const generateFixturesSchema = z.object({
  seasonId: id,
  legs: z.union([z.literal(1), z.literal(2)]),
  firstKickoff: matchTime,
  daysBetweenRounds: z.number().int().min(1).max(60),
  minutesBetweenMatches: z.number().int().min(15).max(600),
  venueId: id.nullable().optional()
})

export const knockoutProposalSchema = z.object({ seasonId: id, qualifiersPerGroup: z.number().int().min(1).max(8) })

export const createKnockoutSchema = z.object({
  seasonId: id,
  teamIds: z.array(id).min(2, 'A bracket needs at least two teams.').max(MAX_BRACKET_TEAMS, `A bracket can hold at most ${MAX_BRACKET_TEAMS} teams.`),
  thirdPlace: z.boolean()
}).refine((b) => new Set(b.teamIds).size === b.teamIds.length, { message: 'A team can only be in the bracket once.', path: ['teamIds'] })

export const scheduleTieSchema = z.object({
  tieId: id,
  scheduledAt: matchTime,
  venueId: id.nullable().optional()
})
