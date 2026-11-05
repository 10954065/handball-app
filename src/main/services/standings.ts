import { and, eq } from 'drizzle-orm'
import { computeStandings } from '@shared/domain/standings'
import type { StandingRowDTO } from '@shared/dto'
import { competitions, matches, seasons, seasonTeams, teams } from '../db/schema'
import { type Ctx, notFound } from './ctx'

/** Standings for a season, computed from finalized matches only (unfinished matches never count). */
export function seasonStandings(ctx: Ctx, seasonId: string): StandingRowDTO[] {
  const season = ctx.db.select().from(seasons).where(eq(seasons.id, seasonId)).get() ?? notFound('Season')
  const comp = ctx.db.select().from(competitions).where(eq(competitions.id, season.competitionId)).get() ?? notFound('Competition')
  const registered = ctx.db
    .select({ teamId: teams.id, name: teams.name, code: teams.code, logoMediaId: teams.logoMediaId, primaryColor: teams.primaryColor, groupName: seasonTeams.groupName })
    .from(seasonTeams)
    .innerJoin(teams, eq(teams.id, seasonTeams.teamId))
    .where(eq(seasonTeams.seasonId, seasonId))
    .all()
  const finished = ctx.db
    .select()
    .from(matches)
    .where(and(eq(matches.seasonId, seasonId), eq(matches.status, 'finished')))
    .all()
    .filter((m) => (m.stage === 'league' || m.stage === 'group') && m.homeScore !== null && m.awayScore !== null && m.winnerSide)
  const rows = computeStandings(
    registered.map((t) => ({ teamId: t.teamId, groupName: t.groupName, name: t.name })),
    finished.map((m) => ({ homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, homeScore: m.homeScore!, awayScore: m.awayScore!, winnerSide: m.winnerSide! })),
    comp
  )
  const byId = new Map(registered.map((t) => [t.teamId, t]))
  return rows.map((r) => {
    const t = byId.get(r.teamId)!
    return { ...r, teamName: t.name, code: t.code, logoMediaId: t.logoMediaId, primaryColor: t.primaryColor }
  })
}
