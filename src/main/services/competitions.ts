import { and, asc, count, desc, eq, inArray, or } from 'drizzle-orm'
import type { z } from 'zod'
import type { CompetitionDTO, SeasonDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import type { competitionInputSchema, competitionUpdateSchema, seasonInputSchema, seasonTeamsSchema, seasonUpdateSchema } from '@shared/schemas/entities'
import { competitions, knockoutTies, matches, seasons, seasonTeams, teams } from '../db/schema'
import { audit } from './audit'
import { type Ctx, notFound, nowOf, tx, uuid } from './ctx'

function seasonDTO(ctx: Ctx, s: typeof seasons.$inferSelect): SeasonDTO {
  const teamRows = ctx.db
    .select({ teamId: teams.id, teamName: teams.name, code: teams.code, primaryColor: teams.primaryColor, logoMediaId: teams.logoMediaId, groupName: seasonTeams.groupName })
    .from(seasonTeams)
    .innerJoin(teams, eq(teams.id, seasonTeams.teamId))
    .where(eq(seasonTeams.seasonId, s.id))
    .orderBy(asc(seasonTeams.groupName), asc(teams.name))
    .all()
  const matchCount = ctx.db.select({ n: count() }).from(matches).where(eq(matches.seasonId, s.id)).get()?.n ?? 0
  return { id: s.id, competitionId: s.competitionId, name: s.name, startDate: s.startDate, endDate: s.endDate, status: s.status, teams: teamRows, matchCount }
}

function toDTO(ctx: Ctx, c: typeof competitions.$inferSelect): CompetitionDTO {
  const ss = ctx.db.select().from(seasons).where(eq(seasons.competitionId, c.id)).orderBy(desc(seasons.createdAt)).all()
  return {
    id: c.id,
    name: c.name,
    shortName: c.shortName,
    type: c.type,
    category: c.category,
    organizer: c.organizer,
    rules: c.rules,
    pointsWin: c.pointsWin,
    pointsDraw: c.pointsDraw,
    pointsLoss: c.pointsLoss,
    tiebreakers: c.tiebreakers,
    logoMediaId: c.logoMediaId,
    archived: c.archived,
    seasons: ss.map((s) => seasonDTO(ctx, s))
  }
}

export function listCompetitions(ctx: Ctx, q?: { includeArchived?: boolean }): CompetitionDTO[] {
  return ctx.db
    .select()
    .from(competitions)
    .where(q?.includeArchived ? undefined : eq(competitions.archived, false))
    .orderBy(asc(competitions.name))
    .all()
    .map((c) => toDTO(ctx, c))
}

export function getCompetition(ctx: Ctx, id: string): CompetitionDTO {
  const c = ctx.db.select().from(competitions).where(eq(competitions.id, id)).get() ?? notFound('Competition')
  return toDTO(ctx, c)
}

export function createCompetition(ctx: Ctx, input: z.output<typeof competitionInputSchema>): CompetitionDTO {
  const id = uuid()
  tx(ctx, () => {
    ctx.db.insert(competitions).values({ ...input, id, createdAt: nowOf(ctx), updatedAt: nowOf(ctx) }).run()
    audit(ctx, { action: 'competitions.create', entity: 'competitions', entityId: id, after: input })
  })
  return getCompetition(ctx, id)
}

/** Rule changes apply to matches created afterwards; existing matches keep their rule snapshot. */
export function updateCompetition(ctx: Ctx, input: z.output<typeof competitionUpdateSchema>): CompetitionDTO {
  const before = getCompetition(ctx, input.id)
  const { id, ...values } = input
  tx(ctx, () => {
    ctx.db.update(competitions).set({ ...values, updatedAt: nowOf(ctx) }).where(eq(competitions.id, id)).run()
    audit(ctx, { action: 'competitions.update', entity: 'competitions', entityId: id, before: { ...before, seasons: undefined }, after: values })
  })
  return getCompetition(ctx, id)
}

export function setCompetitionArchived(ctx: Ctx, id: string, archived: boolean): CompetitionDTO {
  getCompetition(ctx, id)
  tx(ctx, () => {
    ctx.db.update(competitions).set({ archived, updatedAt: nowOf(ctx) }).where(eq(competitions.id, id)).run()
    audit(ctx, { action: archived ? 'competitions.archive' : 'competitions.restore', entity: 'competitions', entityId: id })
  })
  return getCompetition(ctx, id)
}

export function getSeason(ctx: Ctx, id: string): SeasonDTO {
  const s = ctx.db.select().from(seasons).where(eq(seasons.id, id)).get() ?? notFound('Season')
  return seasonDTO(ctx, s)
}

export function createSeason(ctx: Ctx, input: z.output<typeof seasonInputSchema>): SeasonDTO {
  getCompetition(ctx, input.competitionId)
  const id = uuid()
  tx(ctx, () => {
    ctx.db.insert(seasons).values({ ...input, id, createdAt: nowOf(ctx), updatedAt: nowOf(ctx) }).run()
    audit(ctx, { action: 'seasons.create', entity: 'seasons', entityId: id, after: input })
  })
  return getSeason(ctx, id)
}

export function updateSeason(ctx: Ctx, input: z.output<typeof seasonUpdateSchema>): SeasonDTO {
  getSeason(ctx, input.id)
  const { id, ...values } = input
  tx(ctx, () => {
    ctx.db.update(seasons).set({ ...values, updatedAt: nowOf(ctx) }).where(eq(seasons.id, id)).run()
    audit(ctx, { action: 'seasons.update', entity: 'seasons', entityId: id, after: values })
  })
  return getSeason(ctx, id)
}

const hasMatches = (ctx: Ctx, seasonId: string, teamId: string, stages?: ('league' | 'group')[]) =>
  !!ctx.db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.seasonId, seasonId), or(eq(matches.homeTeamId, teamId), eq(matches.awayTeamId, teamId)), stages ? inArray(matches.stage, stages) : undefined))
    .limit(1)
    .get()

const inBracket = (ctx: Ctx, seasonId: string, teamId: string) =>
  !!ctx.db
    .select({ id: knockoutTies.id })
    .from(knockoutTies)
    .where(and(eq(knockoutTies.seasonId, seasonId), or(eq(knockoutTies.homeTeamId, teamId), eq(knockoutTies.awayTeamId, teamId))))
    .limit(1)
    .get()

/**
 * Replace the teams registered in a season. A team with matches or a place in the bracket cannot be
 * removed, and a team with league or group fixtures cannot change group: the table counts matches
 * between teams of one group, so a move would quietly take played matches out of it.
 */
export function setSeasonTeams(ctx: Ctx, input: z.output<typeof seasonTeamsSchema>): SeasonDTO {
  const season = getSeason(ctx, input.seasonId)
  const next = new Map(input.teams.map((t) => [t.teamId, t.groupName || null]))
  const seeds = new Map(ctx.db.select({ teamId: seasonTeams.teamId, seed: seasonTeams.seed }).from(seasonTeams).where(eq(seasonTeams.seasonId, input.seasonId)).all().map((t) => [t.teamId, t.seed]))
  tx(ctx, () => {
    for (const t of season.teams) {
      if (!next.has(t.teamId)) {
        if (hasMatches(ctx, input.seasonId, t.teamId)) throw new AppError('CONFLICT', `${t.teamName} already has matches in this season and cannot be removed.`)
        if (inBracket(ctx, input.seasonId, t.teamId)) throw new AppError('CONFLICT', `${t.teamName} is in the bracket and cannot be removed.`)
      } else if (next.get(t.teamId) !== (t.groupName || null) && hasMatches(ctx, input.seasonId, t.teamId, ['league', 'group'])) {
        throw new AppError('CONFLICT', `${t.teamName} already has group fixtures, so its group cannot change.`)
      }
    }
    ctx.db.delete(seasonTeams).where(eq(seasonTeams.seasonId, input.seasonId)).run()
    for (const t of input.teams) {
      ctx.db.insert(seasonTeams).values({ id: uuid(), seasonId: input.seasonId, teamId: t.teamId, groupName: t.groupName || null, seed: seeds.get(t.teamId) ?? null }).run()
    }
    audit(ctx, { action: 'seasons.teams', entity: 'seasons', entityId: input.seasonId, before: season.teams, after: input.teams })
  })
  return getSeason(ctx, input.seasonId)
}
