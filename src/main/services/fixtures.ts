import { and, eq, inArray } from 'drizzle-orm'
import type { z } from 'zod'
import { fixtureGroups, planFixtures } from '@shared/domain/fixtures'
import { AppError } from '@shared/errors'
import type { generateFixturesSchema } from '@shared/schemas/reports'
import { competitions, matches } from '../db/schema'
import { audit } from './audit'
import { getSeason } from './competitions'
import { type Ctx, notFound, tx } from './ctx'
import { createMatch, deleteMatch } from './matches'

const TABLE_STAGES: ('league' | 'group')[] = ['league', 'group']
const ROUND_ROBIN_TYPES = new Set(['league', 'groups', 'groups_knockout'])

const leagueMatches = (ctx: Ctx, seasonId: string) =>
  ctx.db
    .select({ id: matches.id, status: matches.status })
    .from(matches)
    .where(and(eq(matches.seasonId, seasonId), inArray(matches.stage, TABLE_STAGES)))
    .all()

/** Create every league or group fixture of a season at once, or none of them. */
export function generateFixtures(ctx: Ctx, input: z.output<typeof generateFixturesSchema>): { created: number } {
  const season = getSeason(ctx, input.seasonId)
  const comp = ctx.db.select().from(competitions).where(eq(competitions.id, season.competitionId)).get() ?? notFound('Competition')
  if (!ROUND_ROBIN_TYPES.has(comp.type)) throw new AppError('CONFLICT', 'This type of competition has no league or group fixtures.')
  const grouped = comp.type !== 'league'
  const { groups, problem } = fixtureGroups(season.teams, grouped)
  if (problem) throw new AppError('VALIDATION', problem)
  if (leagueMatches(ctx, season.id).length) {
    throw new AppError('CONFLICT', 'This season already has fixtures. Delete the unplayed ones first, or add single fixtures.')
  }
  const planned = planFixtures(groups, input)
  tx(ctx, () => {
    for (const f of planned) {
      createMatch(ctx, {
        homeTeamId: f.homeTeamId,
        awayTeamId: f.awayTeamId,
        competitionId: comp.id,
        seasonId: season.id,
        venueId: input.venueId ?? null,
        scheduledAt: f.scheduledAt,
        stage: grouped ? 'group' : 'league',
        round: f.round,
        groupName: f.groupName,
        officials: [],
        notes: null
      })
    }
    audit(ctx, { action: 'fixtures.generate', entity: 'seasons', entityId: season.id, after: { ...input, created: planned.length } })
  })
  return { created: planned.length }
}

/**
 * Delete the league or group fixtures nobody has prepared yet. Played matches are never touched, and
 * neither are matches with confirmed lineups: those lineups could not be got back.
 */
export function clearFixtures(ctx: Ctx, seasonId: string): { deleted: number } {
  getSeason(ctx, seasonId)
  const unplayed = leagueMatches(ctx, seasonId).filter((m) => m.status === 'scheduled')
  tx(ctx, () => {
    for (const m of unplayed) deleteMatch(ctx, m.id)
    audit(ctx, { action: 'fixtures.clear', entity: 'seasons', entityId: seasonId, after: { deleted: unplayed.length } })
  })
  return { deleted: unplayed.length }
}
