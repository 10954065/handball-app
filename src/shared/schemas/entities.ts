import { z } from 'zod'
import { COMPETITION_TYPES, GENDERS, MATCH_STAGES, OFFICIAL_ROLES, POSITIONS, REGISTRATION_STATUSES } from '../domain/constants'
import { rulesConfigSchema } from '../domain/rules'
import { hexColor, isoDate, optText, reqText } from './common'

const uuid = z.string().uuid()
const jersey = z.number().int().min(1, 'Use 1-99').max(99, 'Use 1-99')

export const mediaUploadSchema = z.object({
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  base64: z.string().min(16).max(4_000_000),
  width: z.number().int().min(1).max(4096).optional(),
  height: z.number().int().min(1).max(4096).optional()
})

export const teamInputSchema = z.object({
  name: reqText(80),
  shortName: reqText(24),
  code: z.string().trim().min(2).max(4).transform((s) => s.toUpperCase()),
  country: optText(60),
  region: optText(60),
  clubName: optText(80),
  homeVenue: optText(80),
  coach: optText(80),
  assistantCoach: optText(80),
  teamManager: optText(80),
  primaryColor: hexColor,
  secondaryColor: hexColor,
  logoMediaId: uuid.nullable().optional(),
  captainPlayerId: uuid.nullable().optional(),
  primaryGoalkeeperId: uuid.nullable().optional(),
  notes: optText(1000)
})
export const teamUpdateSchema = teamInputSchema.extend({ id: uuid })

export const playerInputSchema = z.object({
  firstName: reqText(60),
  lastName: reqText(60),
  dateOfBirth: isoDate,
  gender: z.enum(GENDERS).nullable().optional(),
  nationality: optText(60),
  position: z.enum(POSITIONS).nullable().optional(),
  heightCm: z.number().int().min(100).max(240).nullable().optional(),
  isGoalkeeper: z.boolean().default(false),
  photoMediaId: uuid.nullable().optional(),
  registrationStatus: z.enum(REGISTRATION_STATUSES).default('registered'),
  notes: optText(1000),
  /** Optional initial team registration. */
  teamId: uuid.nullable().optional(),
  jerseyNumber: jersey.nullable().optional()
})
export const playerUpdateSchema = playerInputSchema.omit({ teamId: true, jerseyNumber: true }).extend({ id: uuid })

export const transferSchema = z.object({
  playerId: uuid,
  /** null releases the player (free agent). */
  toTeamId: uuid.nullable(),
  jerseyNumber: jersey.nullable().optional(),
  effectiveDate: isoDate
})
export const changeJerseySchema = z.object({ playerId: uuid, jerseyNumber: jersey })

export const playerListQuery = z
  .object({
    search: z.string().max(100).optional(),
    teamId: uuid.optional(),
    position: z.enum(POSITIONS).optional(),
    includeArchived: z.boolean().optional(),
    freeAgentsOnly: z.boolean().optional()
  })
  .optional()

export const officialInputSchema = z.object({
  fullName: reqText(80),
  role: z.enum(OFFICIAL_ROLES),
  licenseNo: optText(40),
  region: optText(60),
  phone: optText(40),
  email: z.string().trim().email().or(z.literal('')).nullable().optional(),
  notes: optText(1000)
})
export const officialUpdateSchema = officialInputSchema.extend({ id: uuid })

export const venueInputSchema = z.object({
  name: reqText(80),
  city: optText(60),
  address: optText(200),
  capacity: z.number().int().min(0).max(200_000).nullable().optional(),
  notes: optText(1000)
})
export const venueUpdateSchema = venueInputSchema.extend({ id: uuid })

export const TIEBREAKERS = ['points', 'head_to_head_points', 'head_to_head_goal_difference', 'head_to_head_goals', 'goal_difference', 'goals_for', 'wins'] as const
export type Tiebreaker = (typeof TIEBREAKERS)[number]

export const competitionInputSchema = z.object({
  name: reqText(100),
  shortName: optText(30),
  type: z.enum(COMPETITION_TYPES),
  category: optText(60),
  organizer: optText(100),
  rules: rulesConfigSchema,
  pointsWin: z.number().int().min(0).max(10),
  pointsDraw: z.number().int().min(0).max(10),
  pointsLoss: z.number().int().min(0).max(10),
  tiebreakers: z.array(z.enum(TIEBREAKERS)).min(1).max(TIEBREAKERS.length),
  logoMediaId: uuid.nullable().optional()
})
export const competitionUpdateSchema = competitionInputSchema.extend({ id: uuid })

export const seasonInputSchema = z.object({
  competitionId: uuid,
  name: reqText(40),
  startDate: isoDate,
  endDate: isoDate,
  status: z.enum(['planned', 'active', 'completed']).default('planned')
})
export const seasonUpdateSchema = seasonInputSchema.omit({ competitionId: true }).extend({ id: uuid })

export const seasonTeamsSchema = z.object({
  seasonId: uuid,
  teams: z.array(z.object({ teamId: uuid, groupName: z.string().trim().max(20).nullable().optional() })).max(64)
})

export const matchInputSchema = z
  .object({
    homeTeamId: uuid,
    awayTeamId: uuid,
    competitionId: uuid.nullable().optional(),
    seasonId: uuid.nullable().optional(),
    venueId: uuid.nullable().optional(),
    scheduledAt: z.number().int().min(0),
    stage: z.enum(MATCH_STAGES).default('league'),
    round: z.number().int().min(1).max(200).nullable().optional(),
    groupName: optText(20),
    rules: rulesConfigSchema.optional(),
    officials: z.array(z.object({ officialId: uuid, role: z.string().trim().min(1).max(40) })).max(8).default([]),
    notes: optText(1000)
  })
  .refine((m) => m.homeTeamId !== m.awayTeamId, { message: 'A team cannot play itself', path: ['awayTeamId'] })
export const matchUpdateSchema = z.object({
  id: uuid,
  venueId: uuid.nullable().optional(),
  scheduledAt: z.number().int().min(0).optional(),
  stage: z.enum(MATCH_STAGES).optional(),
  round: z.number().int().min(1).max(200).nullable().optional(),
  groupName: optText(20),
  officials: z.array(z.object({ officialId: uuid, role: z.string().trim().min(1).max(40) })).max(8).optional(),
  notes: optText(1000)
})
export const matchListQuery = z
  .object({
    status: z.array(z.enum(['scheduled', 'ready', 'live', 'finished', 'abandoned'])).optional(),
    seasonId: uuid.optional(),
    competitionId: uuid.optional(),
    teamId: uuid.optional(),
    /** Scheduled between these times (inclusive). */
    from: z.number().int().optional(),
    to: z.number().int().optional(),
    search: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(1000).default(500)
  })
  .optional()
