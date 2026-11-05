import { eq } from 'drizzle-orm'
import type { SeasonReportDTO } from '@shared/dto'
import { competitions } from '../../db/schema'
import { getSeason } from '../competitions'
import { type Ctx, notFound } from '../ctx'
import { getBracket } from '../knockout'
import { listMatches } from '../matches'
import { getSettings } from '../settings'
import { seasonStandings } from '../standings'
import { statisticsOverview } from '../statistics'

const TABLE_TYPES = new Set(['league', 'groups', 'groups_knockout'])
const BRACKET_TYPES = new Set(['knockout', 'groups_knockout'])
const ALL_FIXTURES = 100_000

/** Everything a competition report shows. All of it is calculated from finalized matches. */
export function seasonReport(ctx: Ctx, seasonId: string): SeasonReportDTO {
  const season = getSeason(ctx, seasonId)
  const comp = ctx.db.select().from(competitions).where(eq(competitions.id, season.competitionId)).get() ?? notFound('Competition')
  const settings = getSettings(ctx)
  const fixtures = listMatches(ctx, { seasonId, limit: ALL_FIXTURES }).sort((a, b) => a.scheduledAt - b.scheduledAt)
  const counted = fixtures.filter((m) => m.status !== 'abandoned')
  const played = counted.filter((m) => m.status === 'finished').length
  const bracket = BRACKET_TYPES.has(comp.type) ? getBracket(ctx, seasonId) : null
  return {
    organisationName: settings.organisationName,
    footerNote: settings.reports.footerNote,
    demo: ctx.mode === 'demo',
    competition: { name: comp.name, type: comp.type, category: comp.category, organizer: comp.organizer, pointsWin: comp.pointsWin, pointsDraw: comp.pointsDraw, pointsLoss: comp.pointsLoss, tiebreakers: comp.tiebreakers },
    season: { id: season.id, name: season.name, startDate: season.startDate, endDate: season.endDate, status: season.status },
    played,
    scheduled: counted.length,
    inProgress: played < counted.length || (!!bracket && !bracket.champion),
    standings: TABLE_TYPES.has(comp.type) ? seasonStandings(ctx, seasonId) : [],
    bracket,
    fixtures,
    statistics: statisticsOverview(ctx, { seasonId })
  }
}
