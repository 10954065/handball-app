import { and, asc, eq, isNull } from 'drizzle-orm'
import type { z } from 'zod'
import { appearances, percent } from '@shared/domain/statistics'
import { liveTallies } from '@shared/domain/tally'
import type { StatGoalkeeperDTO, StatisticsOverviewDTO, StatPlayerDTO, StatTeamDTO } from '@shared/dto'
import type { statisticsQuery } from '@shared/schemas/reports'
import { matches, players, playerStatistics, teams, teamStatistics } from '../db/schema'
import { type Ctx, nowOf, tx, uuid } from './ctx'
import { loadLive } from './live/state'

export type StatisticsQuery = z.output<typeof statisticsQuery>

/**
 * Rebuild the statistics cache of a finalized match from its ledger.
 * Runs inside the transaction that finalizes or corrects the match, so the two cannot disagree.
 */
export function syncMatchStatistics(ctx: Ctx, matchId: string): void {
  const d = loadLive(ctx, matchId)
  if (d.row.status !== 'finished') return
  const tallies = liveTallies(d.events)
  const played = appearances(d.events, d.roster)
  const at = nowOf(ctx)
  ctx.db.delete(playerStatistics).where(eq(playerStatistics.matchId, matchId)).run()
  ctx.db.delete(teamStatistics).where(eq(teamStatistics.matchId, matchId)).run()
  for (const r of d.roster) {
    const t = tallies.players.get(r.id)
    ctx.db
      .insert(playerStatistics)
      .values({ ...t, id: uuid(), matchId, playerId: r.playerId, teamId: r.teamId, rosterId: r.id, isGoalkeeper: r.isGoalkeeper, played: played.has(r.id), updatedAt: at })
      .run()
  }
  for (const side of ['home', 'away'] as const) {
    const t = tallies.teams[side]
    ctx.db
      .insert(teamStatistics)
      .values({
        ...t,
        id: uuid(),
        matchId,
        teamId: side === 'home' ? d.row.homeTeamId : d.row.awayTeamId,
        side,
        shootingPct: percent(t.goals, t.shots),
        savePct: percent(t.saves, t.saves + t.goalsConceded),
        updatedAt: at
      })
      .run()
  }
}

/** Finalized matches without a cache, such as those in a backup restored from an older version. */
export function ensureStatistics(ctx: Ctx): void {
  const missing = ctx.db
    .select({ id: matches.id })
    .from(matches)
    .leftJoin(teamStatistics, eq(teamStatistics.matchId, matches.id))
    .where(and(eq(matches.status, 'finished'), isNull(teamStatistics.id)))
    .all()
  if (missing.length) tx(ctx, () => missing.forEach((m) => syncMatchStatistics(ctx, m.id)))
}

const scopeOf = (q: StatisticsQuery) =>
  and(
    eq(matches.status, 'finished'),
    q.seasonId ? eq(matches.seasonId, q.seasonId) : undefined,
    q.competitionId ? eq(matches.competitionId, q.competitionId) : undefined
  )

function playerRows(ctx: Ctx, q: StatisticsQuery) {
  return ctx.db
    .select({ s: playerStatistics, first: players.firstName, last: players.lastName, photo: players.photoMediaId, teamName: teams.name, teamColor: teams.primaryColor })
    .from(playerStatistics)
    .innerJoin(matches, eq(matches.id, playerStatistics.matchId))
    .innerJoin(players, eq(players.id, playerStatistics.playerId))
    .innerJoin(teams, eq(teams.id, playerStatistics.teamId))
    .where(and(scopeOf(q), eq(playerStatistics.played, true), q.teamId ? eq(playerStatistics.teamId, q.teamId) : undefined))
    .orderBy(asc(matches.scheduledAt))
    .all()
}

type PlayerRow = ReturnType<typeof playerRows>[number]

const identity = (r: PlayerRow) => ({
  playerId: r.s.playerId,
  name: `${r.first} ${r.last}`,
  photoMediaId: r.photo,
  teamName: r.teamName,
  teamColor: r.teamColor
})

const PLAYER_FIELDS = ['goals', 'shots', 'sevenMetreGoals', 'sevenMetreShots', 'assists', 'steals', 'blocks', 'turnovers', 'technicalFaults', 'warnings', 'suspensions', 'disqualifications'] as const
const KEEPER_FIELDS = ['saves', 'shotsFaced', 'goalsConceded', 'sevenMetreSaves', 'sevenMetreFaced'] as const
const TEAM_FIELDS = ['shots', 'saves', 'sevenMetreGoals', 'sevenMetreShots', 'technicalFaults', 'turnovers', 'steals', 'blocks', 'warnings', 'suspensions', 'disqualifications', 'timeouts', 'goalsConceded', 'sevenMetreSaves', 'sevenMetreFaced'] as const

const zeros = <K extends string>(fields: readonly K[]) => Object.fromEntries(fields.map((f) => [f, 0])) as Record<K, number>

/** A new total with the named counters of row added on. */
function plus<T extends Record<K, number>, K extends string>(total: T, row: Record<K, number>, fields: readonly K[]): T {
  return { ...total, ...Object.fromEntries(fields.map((f) => [f, total[f] + row[f]])) }
}

function teamTotals(ctx: Ctx, q: StatisticsQuery): StatTeamDTO[] {
  const rows = ctx.db
    .select({ s: teamStatistics, winner: matches.winnerSide, name: teams.name, code: teams.code, color: teams.primaryColor })
    .from(teamStatistics)
    .innerJoin(matches, eq(matches.id, teamStatistics.matchId))
    .innerJoin(teams, eq(teams.id, teamStatistics.teamId))
    .where(and(scopeOf(q), q.teamId ? eq(teamStatistics.teamId, q.teamId) : undefined))
    .all()
  const totals = new Map<string, StatTeamDTO>()
  for (const r of rows) {
    const base: StatTeamDTO = totals.get(r.s.teamId) ?? { ...zeros(TEAM_FIELDS), teamId: r.s.teamId, name: r.name, code: r.code, color: r.color, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0 }
    const won = r.winner === r.s.side
    const drawn = r.winner === 'draw'
    totals.set(r.s.teamId, {
      ...plus(base, r.s, TEAM_FIELDS),
      played: base.played + 1,
      won: base.won + (won ? 1 : 0),
      drawn: base.drawn + (drawn ? 1 : 0),
      lost: base.lost + (!won && !drawn ? 1 : 0),
      goalsFor: base.goalsFor + r.s.goals
    })
  }
  const difference = (t: StatTeamDTO) => t.goalsFor - t.goalsConceded
  return [...totals.values()].sort((a, b) => b.won - a.won || difference(b) - difference(a) || a.name.localeCompare(b.name))
}

/** Totals over finalized matches, read from the cache of the ledger. Rows run oldest first, so a player shows their latest team. */
export function statisticsOverview(ctx: Ctx, q: StatisticsQuery): StatisticsOverviewDTO {
  ensureStatistics(ctx)
  const outfield = new Map<string, StatPlayerDTO>()
  const keepers = new Map<string, StatGoalkeeperDTO>()
  for (const r of playerRows(ctx, q)) {
    const id = r.s.playerId
    const p = outfield.get(id) ?? { ...zeros(PLAYER_FIELDS), ...identity(r), matches: 0 }
    outfield.set(id, { ...plus(p, r.s, PLAYER_FIELDS), ...identity(r), matches: p.matches + 1 })
    if (r.s.isGoalkeeper || r.s.shotsFaced > 0) {
      const k = keepers.get(id) ?? { ...zeros(KEEPER_FIELDS), ...identity(r), matches: 0 }
      keepers.set(id, { ...plus(k, r.s, KEEPER_FIELDS), ...identity(r), matches: k.matches + 1 })
    }
  }
  const matchIds = ctx.db
    .select({ id: teamStatistics.matchId })
    .from(teamStatistics)
    .innerJoin(matches, eq(matches.id, teamStatistics.matchId))
    .where(and(scopeOf(q), q.teamId ? eq(teamStatistics.teamId, q.teamId) : undefined))
    .all()
  return {
    matches: new Set(matchIds.map((m) => m.id)).size,
    players: [...outfield.values()].sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name)),
    goalkeepers: [...keepers.values()].sort((a, b) => b.saves - a.saves || a.name.localeCompare(b.name)),
    teams: teamTotals(ctx, q)
  }
}
