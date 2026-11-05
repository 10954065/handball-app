import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import type { z } from 'zod'
import { buildBracket, resolveBracket, type ResolvedTie, type TieSlot } from '@shared/domain/bracket'
import type { RulesConfig } from '@shared/domain/rules'
import type { BracketDTO, BracketTeamDTO, BracketTieDTO, KnockoutProposalDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import type { createKnockoutSchema, knockoutProposalSchema, scheduleTieSchema } from '@shared/schemas/reports'
import { competitions, knockoutTies, matches, seasons, seasonTeams, teams } from '../db/schema'
import { audit } from './audit'
import { type Ctx, notFound, nowOf, tx, uuid } from './ctx'
import { createMatch, deleteMatch } from './matches'
import { seasonStandings } from './standings'

const GROUP_STAGES: ('league' | 'group')[] = ['league', 'group']

function competitionOf(ctx: Ctx, seasonId: string) {
  const season = ctx.db.select().from(seasons).where(eq(seasons.id, seasonId)).get() ?? notFound('Season')
  const comp = ctx.db.select().from(competitions).where(eq(competitions.id, season.competitionId)).get() ?? notFound('Competition')
  return { season, comp }
}

const tieRows = (ctx: Ctx, seasonId: string) => ctx.db.select().from(knockoutTies).where(eq(knockoutTies.seasonId, seasonId)).orderBy(asc(knockoutTies.position)).all()

function matchRows(ctx: Ctx, ids: string[]) {
  return ids.length ? ctx.db.select().from(matches).where(inArray(matches.id, ids)).all() : []
}

/** The bracket worked out from its ties and the current state of their matches. */
function resolved(ctx: Ctx, seasonId: string) {
  const rows = tieRows(ctx, seasonId)
  const linked = matchRows(ctx, rows.flatMap((r) => (r.matchId ? [r.matchId] : [])))
  const ties = resolveBracket(rows satisfies TieSlot[], linked)
  return { rows, linked, ties }
}

function teamMap(ctx: Ctx, ties: readonly ResolvedTie[]): Map<string, BracketTeamDTO> {
  const ids = [...new Set(ties.flatMap((t) => [t.homeTeamId, t.awayTeamId]).filter((x): x is string => !!x))]
  const rows = ids.length ? ctx.db.select().from(teams).where(inArray(teams.id, ids)).all() : []
  return new Map(rows.map((t) => [t.id, { teamId: t.id, name: t.name, code: t.code, color: t.primaryColor, logoMediaId: t.logoMediaId }]))
}

export function getBracket(ctx: Ctx, seasonId: string): BracketDTO {
  competitionOf(ctx, seasonId)
  const { rows, linked, ties } = resolved(ctx, seasonId)
  const team = teamMap(ctx, ties)
  const pick = (id: string | null) => (id ? (team.get(id) ?? null) : null)
  const byMatch = new Map(linked.map((m) => [m.id, m]))
  const dto: BracketTieDTO[] = ties.map((t) => {
    const m = t.matchId ? byMatch.get(t.matchId) : undefined
    return {
      id: rows.find((r) => r.stage === t.stage && r.position === t.position)?.id ?? '',
      stage: t.stage,
      position: t.position,
      home: pick(t.homeTeamId),
      away: pick(t.awayTeamId),
      homeSource: t.homeSource,
      awaySource: t.awaySource,
      state: t.state,
      problem: t.problem,
      winnerTeamId: t.winnerTeamId,
      match: m ? { id: m.id, matchNumber: m.matchNumber, status: m.status, scheduledAt: m.scheduledAt, homeScore: m.homeScore, awayScore: m.awayScore, homeShootout: m.homeShootout, awayShootout: m.awayShootout } : null
    }
  })
  return { ties: dto, champion: pick(ties.find((t) => t.stage === 'final')?.winnerTeamId ?? null) }
}

function groupStageProgress(ctx: Ctx, seasonId: string) {
  const rows = ctx.db
    .select({ status: matches.status })
    .from(matches)
    .where(and(eq(matches.seasonId, seasonId), inArray(matches.stage, GROUP_STAGES), ne(matches.status, 'abandoned')))
    .all()
  return { total: rows.length, unfinished: rows.filter((m) => m.status !== 'finished').length }
}

function groupStageBlock(ctx: Ctx, seasonId: string): string | null {
  const { total, unfinished } = groupStageProgress(ctx, seasonId)
  if (!total) return 'The group stage has no fixtures yet.'
  return unfinished ? `${unfinished} group ${unfinished === 1 ? 'match has' : 'matches have'} not been finalized.` : null
}

/**
 * The teams and seed order proposed for a bracket: registered teams by seed for a knockout
 * competition, and group qualifiers for groups + knockout. Group winners are seeded first, in group
 * order, which keeps teams from the same group apart in the first round.
 */
export function knockoutProposal(ctx: Ctx, input: z.output<typeof knockoutProposalSchema>): KnockoutProposalDTO {
  const { comp } = competitionOf(ctx, input.seasonId)
  if (comp.type === 'groups_knockout') {
    const standings = seasonStandings(ctx, input.seasonId)
    const places = Array.from({ length: input.qualifiersPerGroup }, (_, i) => i + 1)
    const qualifiers = places.flatMap((rank) => standings.filter((r) => r.rank === rank))
    const levelWithNext = (r: (typeof standings)[number]) =>
      r.rank === input.qualifiersPerGroup &&
      r.unresolvedTie &&
      standings.some((o) => o.groupName === r.groupName && o.rank === r.rank + 1 && o.points === r.points && o.goalDifference === r.goalDifference && o.goalsFor === r.goalsFor)
    const undecided = qualifiers.filter(levelWithNext)
    return {
      teams: qualifiers.map((r) => ({ teamId: r.teamId, name: r.teamName, code: r.code, color: r.primaryColor, logoMediaId: r.logoMediaId, label: `${r.groupName}${r.rank}` })),
      blocked: groupStageBlock(ctx, input.seasonId),
      warnings: undecided.map((r) => `Group ${r.groupName}: ${r.teamName} is level with the next team on every criterion. Settle this under the regulations and reorder if needed.`)
    }
  }
  const rows = ctx.db
    .select({ t: teams, seed: seasonTeams.seed })
    .from(seasonTeams)
    .innerJoin(teams, eq(teams.id, seasonTeams.teamId))
    .where(eq(seasonTeams.seasonId, input.seasonId))
    .orderBy(asc(seasonTeams.seed), asc(teams.name))
    .all()
  return {
    teams: rows.map(({ t }) => ({ teamId: t.id, name: t.name, code: t.code, color: t.primaryColor, logoMediaId: t.logoMediaId, label: null })),
    blocked: rows.length < 2 ? 'Register at least two teams first.' : null,
    warnings: []
  }
}

/** Create the bracket. The order of the teams is the seeding. */
export function createKnockout(ctx: Ctx, input: z.output<typeof createKnockoutSchema>): BracketDTO {
  const { comp } = competitionOf(ctx, input.seasonId)
  if (comp.type !== 'knockout' && comp.type !== 'groups_knockout') throw new AppError('CONFLICT', 'This type of competition has no knockout rounds.')
  if (tieRows(ctx, input.seasonId).length) throw new AppError('CONFLICT', 'This season already has a bracket.')
  if (comp.type === 'groups_knockout') {
    const block = groupStageBlock(ctx, input.seasonId)
    if (block) throw new AppError('CONFLICT', block)
  }
  const registered = new Set(ctx.db.select({ id: seasonTeams.teamId }).from(seasonTeams).where(eq(seasonTeams.seasonId, input.seasonId)).all().map((t) => t.id))
  if (input.teamIds.some((id) => !registered.has(id))) throw new AppError('VALIDATION', 'Every team in the bracket must be registered in this season.')
  tx(ctx, () => {
    for (const t of buildBracket(input.teamIds, input.thirdPlace)) {
      ctx.db.insert(knockoutTies).values({ ...t, id: uuid(), seasonId: input.seasonId, createdAt: nowOf(ctx) }).run()
    }
    input.teamIds.forEach((teamId, i) => {
      ctx.db.update(seasonTeams).set({ seed: i + 1 }).where(and(eq(seasonTeams.seasonId, input.seasonId), eq(seasonTeams.teamId, teamId))).run()
    })
    audit(ctx, { action: 'knockout.create', entity: 'seasons', entityId: input.seasonId, after: input })
  })
  return getBracket(ctx, input.seasonId)
}

/** A knockout match must produce a winner, so it always ends in a shoot-out if the score stays level. */
export const knockoutRules = (rules: RulesConfig): RulesConfig => ({ ...rules, drawAllowed: false, shootout: { ...rules.shootout, enabled: true } })

/** Create the fixture of a tie whose two teams are known. */
export function scheduleTie(ctx: Ctx, input: z.output<typeof scheduleTieSchema>): BracketDTO {
  const row = ctx.db.select().from(knockoutTies).where(eq(knockoutTies.id, input.tieId)).get() ?? notFound('Tie')
  const { comp } = competitionOf(ctx, row.seasonId)
  const tie = resolved(ctx, row.seasonId).ties.find((t) => t.stage === row.stage && t.position === row.position)
  if (tie?.state !== 'ready' || !tie.homeTeamId || !tie.awayTeamId) throw new AppError('CONFLICT', 'Both teams of this tie must be known, and it must not have a fixture yet.')
  const { homeTeamId, awayTeamId } = tie
  tx(ctx, () => {
    const match = createMatch(ctx, {
      homeTeamId,
      awayTeamId,
      competitionId: comp.id,
      seasonId: row.seasonId,
      venueId: input.venueId ?? null,
      scheduledAt: input.scheduledAt,
      stage: row.stage,
      round: row.position,
      groupName: null,
      rules: knockoutRules(comp.rules),
      officials: [],
      notes: null
    })
    ctx.db.update(knockoutTies).set({ matchId: match.id }).where(eq(knockoutTies.id, row.id)).run()
  })
  return getBracket(ctx, row.seasonId)
}

/** Remove a bracket that has not started, with its unplayed fixtures. */
export function clearKnockout(ctx: Ctx, seasonId: string): void {
  competitionOf(ctx, seasonId)
  const { linked } = resolved(ctx, seasonId)
  if (linked.some((m) => m.status !== 'scheduled' && m.status !== 'ready')) throw new AppError('CONFLICT', 'A bracket with a played match cannot be removed.')
  tx(ctx, () => {
    for (const m of linked) deleteMatch(ctx, m.id)
    ctx.db.delete(knockoutTies).where(eq(knockoutTies.seasonId, seasonId)).run()
    audit(ctx, { action: 'knockout.clear', entity: 'seasons', entityId: seasonId })
  })
}
