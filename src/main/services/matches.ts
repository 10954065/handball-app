import { aliasedTable, and, asc, desc, eq, gte, inArray, like, lte, or } from 'drizzle-orm'
import type { z } from 'zod'
import { DEFAULT_RULES, findPreset } from '@shared/domain/rules'
import type { MatchDetailDTO, MatchSummaryDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import type { matchInputSchema, matchListQuery, matchUpdateSchema } from '@shared/schemas/entities'
import { competitions, matchEvents, matchLineups, matchOfficials, matches, officials, seasons, seasonTeams, teams, venues } from '../db/schema'
import { audit } from './audit'
import { type Ctx, notFound, nowOf, tx, uuid } from './ctx'
import { getSettings } from './settings'

const home = aliasedTable(teams, 'home')
const away = aliasedTable(teams, 'away')

function summaryQuery(ctx: Ctx) {
  return ctx.db
    .select({ m: matches, home, away, competitionName: competitions.name, seasonName: seasons.name, venueName: venues.name })
    .from(matches)
    .innerJoin(home, eq(home.id, matches.homeTeamId))
    .innerJoin(away, eq(away.id, matches.awayTeamId))
    .leftJoin(competitions, eq(competitions.id, matches.competitionId))
    .leftJoin(seasons, eq(seasons.id, matches.seasonId))
    .leftJoin(venues, eq(venues.id, matches.venueId))
}

type SummaryRow = ReturnType<ReturnType<typeof summaryQuery>['all']>[number]

function toSummary(r: SummaryRow, confirmed: Set<string>): MatchSummaryDTO {
  const m = r.m
  return {
    id: m.id,
    matchNumber: m.matchNumber,
    scheduledAt: m.scheduledAt,
    status: m.status,
    stage: m.stage,
    round: m.round,
    groupName: m.groupName,
    competitionId: m.competitionId,
    competitionName: r.competitionName,
    seasonId: m.seasonId,
    seasonName: r.seasonName,
    venueId: m.venueId,
    venueName: r.venueName,
    home: { teamId: m.homeTeamId, name: m.homeTeamName, code: r.home.code, color: m.homeColor, logoMediaId: r.home.logoMediaId },
    away: { teamId: m.awayTeamId, name: m.awayTeamName, code: r.away.code, color: m.awayColor, logoMediaId: r.away.logoMediaId },
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    homeShootout: m.homeShootout,
    awayShootout: m.awayShootout,
    winnerSide: m.winnerSide,
    amended: m.amended,
    lineupsConfirmed: { home: confirmed.has(`${m.id}:home`), away: confirmed.has(`${m.id}:away`) }
  }
}

function confirmedLineups(ctx: Ctx, ids: string[]): Set<string> {
  if (!ids.length) return new Set()
  const rows = ctx.db
    .select({ matchId: matchLineups.matchId, side: matchLineups.side, at: matchLineups.confirmedAt })
    .from(matchLineups)
    .where(inArray(matchLineups.matchId, ids))
    .all()
  return new Set(rows.filter((r) => r.at).map((r) => `${r.matchId}:${r.side}`))
}

export function listMatches(ctx: Ctx, q: z.output<typeof matchListQuery>): MatchSummaryDTO[] {
  const s = q?.search?.trim()
  const upcomingOnly = !!q?.status?.length && q.status.every((x) => x === 'scheduled' || x === 'ready')
  const rows = summaryQuery(ctx)
    .where(
      and(
        q?.status?.length ? inArray(matches.status, q.status) : undefined,
        q?.seasonId ? eq(matches.seasonId, q.seasonId) : undefined,
        q?.competitionId ? eq(matches.competitionId, q.competitionId) : undefined,
        q?.from ? gte(matches.scheduledAt, q.from) : undefined,
        q?.to ? lte(matches.scheduledAt, q.to) : undefined,
        q?.teamId ? or(eq(matches.homeTeamId, q.teamId), eq(matches.awayTeamId, q.teamId)) : undefined,
        s ? or(like(matches.homeTeamName, `%${s}%`), like(matches.awayTeamName, `%${s}%`), like(matches.matchNumber, `%${s}%`)) : undefined
      )
    )
    .orderBy(upcomingOnly ? asc(matches.scheduledAt) : desc(matches.scheduledAt))
    .limit(q?.limit ?? 500)
    .all()
  const confirmed = confirmedLineups(ctx, rows.map((r) => r.m.id))
  return rows.map((r) => toSummary(r, confirmed))
}

export function getMatch(ctx: Ctx, id: string): MatchDetailDTO {
  const r = summaryQuery(ctx).where(eq(matches.id, id)).get() ?? notFound('Match')
  const offs = ctx.db
    .select({ officialId: matchOfficials.officialId, name: matchOfficials.name, role: matchOfficials.role })
    .from(matchOfficials)
    .where(eq(matchOfficials.matchId, id))
    .all()
  return { ...toSummary(r, confirmedLineups(ctx, [id])), rules: r.m.rules, notes: r.m.notes, officials: offs }
}

function nextMatchNumber(ctx: Ctx, at: number): string {
  const year = new Date(at).getUTCFullYear()
  const row = ctx.sqlite
    .prepare('SELECT max(CAST(substr(match_number, 8) AS INTEGER)) AS n FROM matches WHERE match_number LIKE ?')
    .get(`M-${year}-%`) as { n: number | null }
  return `M-${year}-${String((row.n ?? 0) + 1).padStart(4, '0')}`
}

function writeOfficials(ctx: Ctx, matchId: string, list: { officialId: string; role: string }[]): void {
  ctx.db.delete(matchOfficials).where(eq(matchOfficials.matchId, matchId)).run()
  for (const o of list) {
    const off = ctx.db.select().from(officials).where(eq(officials.id, o.officialId)).get() ?? notFound('Official')
    ctx.db.insert(matchOfficials).values({ id: uuid(), matchId, officialId: o.officialId, role: o.role, name: off.fullName }).run()
  }
}

const TABLE_STAGES = new Set(['league', 'group'])

/** The table counts matches between registered teams, so anything else would quietly be left out of it. */
function assertRegistered(ctx: Ctx, seasonId: string | null | undefined, stage: string, teamIds: [string, string]): void {
  if (!seasonId || !TABLE_STAGES.has(stage)) return
  const found = ctx.db.select({ id: seasonTeams.teamId }).from(seasonTeams).where(and(eq(seasonTeams.seasonId, seasonId), inArray(seasonTeams.teamId, teamIds))).all()
  if (found.length < 2) throw new AppError('VALIDATION', 'Both teams must be registered in the season before a league or group match. Add them under Manage teams.')
}

/** Create a match. Rules and team names/colours are snapshotted so later edits never alter it. */
export function createMatch(ctx: Ctx, input: z.output<typeof matchInputSchema>): MatchDetailDTO {
  const h = ctx.db.select().from(teams).where(eq(teams.id, input.homeTeamId)).get() ?? notFound('Home team')
  const a = ctx.db.select().from(teams).where(eq(teams.id, input.awayTeamId)).get() ?? notFound('Away team')
  if (h.archived || a.archived) throw new AppError('VALIDATION', 'Archived teams cannot be scheduled.')
  const comp = input.competitionId
    ? (ctx.db.select().from(competitions).where(eq(competitions.id, input.competitionId)).get() ?? notFound('Competition'))
    : null
  if (input.seasonId) {
    const s = ctx.db.select().from(seasons).where(eq(seasons.id, input.seasonId)).get() ?? notFound('Season')
    if (!comp || s.competitionId !== comp.id) throw new AppError('VALIDATION', 'The season does not belong to the selected competition.')
  }
  const stage = comp?.type === 'friendly' ? 'friendly' : input.stage
  assertRegistered(ctx, input.seasonId, stage, [h.id, a.id])
  const rules = input.rules ?? comp?.rules ?? findPreset(getSettings(ctx).defaultRulesPresetId) ?? DEFAULT_RULES
  const awayColor = a.primaryColor.toLowerCase() === h.primaryColor.toLowerCase() ? a.secondaryColor : a.primaryColor
  const id = uuid()
  tx(ctx, () => {
    ctx.db
      .insert(matches)
      .values({
        id,
        matchNumber: nextMatchNumber(ctx, input.scheduledAt),
        competitionId: comp?.id ?? null,
        seasonId: input.seasonId ?? null,
        homeTeamId: h.id,
        awayTeamId: a.id,
        venueId: input.venueId ?? null,
        scheduledAt: input.scheduledAt,
        stage,
        round: input.round ?? null,
        groupName: input.groupName ?? null,
        rules,
        homeTeamName: h.name,
        awayTeamName: a.name,
        homeColor: h.primaryColor,
        awayColor,
        notes: input.notes ?? null,
        createdAt: nowOf(ctx),
        updatedAt: nowOf(ctx)
      })
      .run()
    writeOfficials(ctx, id, input.officials)
    audit(ctx, { action: 'matches.create', entity: 'matches', entityId: id, matchId: id, after: { ...input, rules: rules.presetId } })
  })
  return getMatch(ctx, id)
}

const EDITABLE = new Set(['scheduled', 'ready'])

export function updateMatch(ctx: Ctx, input: z.output<typeof matchUpdateSchema>): MatchDetailDTO {
  const before = getMatch(ctx, input.id)
  if (!EDITABLE.has(before.status)) throw new AppError('CONFLICT', 'Only matches that have not started can be edited here.')
  assertRegistered(ctx, before.seasonId, input.stage ?? before.stage, [before.home.teamId, before.away.teamId])
  const { id, officials: offs, ...values } = input
  tx(ctx, () => {
    ctx.db.update(matches).set({ ...values, updatedAt: nowOf(ctx) }).where(eq(matches.id, id)).run()
    if (offs) writeOfficials(ctx, id, offs)
    audit(ctx, { action: 'matches.update', entity: 'matches', entityId: id, matchId: id, before, after: input })
  })
  return getMatch(ctx, id)
}

/** Delete a fixture that has never started. Played matches are never deleted. */
export function deleteMatch(ctx: Ctx, id: string): void {
  const m = getMatch(ctx, id)
  const started = ctx.db.select({ id: matchEvents.id }).from(matchEvents).where(eq(matchEvents.matchId, id)).limit(1).get()
  if (!EDITABLE.has(m.status) || started) throw new AppError('CONFLICT', 'A match that has started cannot be deleted.')
  tx(ctx, () => {
    ctx.db.delete(matches).where(eq(matches.id, id)).run()
    audit(ctx, { action: 'matches.delete', entity: 'matches', entityId: id, before: m })
  })
}
