import { and, count, desc, eq, inArray, ne } from 'drizzle-orm'
import type { DashboardDTO } from '@shared/dto'
import { competitions, matchEvents, matchRosters, matches, officials, players, seasons, teamPlayers, teams } from '../db/schema'
import { listAudit } from './audit'
import type { Ctx } from './ctx'
import { listMatches } from './matches'
import { seasonStandings } from './standings'

export function getDashboard(ctx: Ctx): DashboardDTO {
  const n = (q: { n: number } | undefined) => q?.n ?? 0
  const totals = {
    competitions: n(ctx.db.select({ n: count() }).from(competitions).where(eq(competitions.archived, false)).get()),
    teams: n(ctx.db.select({ n: count() }).from(teams).where(eq(teams.archived, false)).get()),
    players: n(ctx.db.select({ n: count() }).from(players).where(eq(players.archived, false)).get()),
    matchesPlayed: n(ctx.db.select({ n: count() }).from(matches).where(eq(matches.status, 'finished')).get()),
    officials: n(ctx.db.select({ n: count() }).from(officials).where(eq(officials.archived, false)).get())
  }

  const goals = ctx.db
    .select({ playerId: matchRosters.playerId, matchId: matchRosters.matchId })
    .from(matchEvents)
    .innerJoin(matchRosters, eq(matchRosters.id, matchEvents.rosterId))
    .innerJoin(matches, eq(matches.id, matchEvents.matchId))
    .where(
      and(
        eq(matchEvents.status, 'active'),
        eq(matchEvents.type, 'shot'),
        eq(matchEvents.outcome, 'goal'),
        ne(matchEvents.situation, 'shootout'),
        inArray(matches.status, ['live', 'finished'])
      )
    )
    .all()
  const tally = new Map<string, { goals: number; matches: Set<string> }>()
  for (const g of goals) {
    const t = tally.get(g.playerId) ?? { goals: 0, matches: new Set<string>() }
    t.goals++
    t.matches.add(g.matchId)
    tally.set(g.playerId, t)
  }
  const top = [...tally.entries()].sort((a, b) => b[1].goals - a[1].goals).slice(0, 8)
  const topScorers = top.map(([playerId, t]) => {
    const p = ctx.db
      .select({ first: players.firstName, last: players.lastName, photo: players.photoMediaId, teamName: teams.name })
      .from(players)
      .leftJoin(teamPlayers, and(eq(teamPlayers.playerId, players.id)))
      .leftJoin(teams, eq(teams.id, teamPlayers.teamId))
      .where(eq(players.id, playerId))
      .orderBy(desc(teamPlayers.joinedAt))
      .get()
    return { playerId, name: p ? `${p.first} ${p.last}` : 'Unknown', teamName: p?.teamName ?? null, photoMediaId: p?.photo ?? null, goals: t.goals, matches: t.matches.size }
  })

  const activeSeason =
    ctx.db.select().from(seasons).where(eq(seasons.status, 'active')).orderBy(desc(seasons.updatedAt)).get() ??
    ctx.db.select().from(seasons).orderBy(desc(seasons.updatedAt)).get()
  let standings: DashboardDTO['standings'] = null
  if (activeSeason) {
    const comp = ctx.db.select().from(competitions).where(eq(competitions.id, activeSeason.competitionId)).get()
    const rows = seasonStandings(ctx, activeSeason.id)
    if (rows.length) standings = { seasonId: activeSeason.id, title: `${comp?.name ?? ''} ${activeSeason.name}`.trim(), rows }
  }

  return {
    totals,
    liveMatches: listMatches(ctx, { status: ['live'], limit: 5 }),
    upcoming: listMatches(ctx, { status: ['scheduled', 'ready'], limit: 6 }),
    recentResults: listMatches(ctx, { status: ['finished'], limit: 6 }),
    activity: listAudit(ctx, { limit: 12, offset: 0 }).filter((a) => a.action !== 'auth.login'),
    topScorers,
    standings
  }
}
