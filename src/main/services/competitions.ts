import { and, asc, count, desc, eq, or } from 'drizzle-orm'
import type { z } from 'zod'
import type { CompetitionDTO, SeasonDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import type { competitionInputSchema, competitionUpdateSchema, seasonInputSchema, seasonTeamsSchema, seasonUpdateSchema } from '@shared/schemas/entities'
import { competitions, matches, seasons, seasonTeams, teams } from '../db/schema'
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

/** Replace the teams registered in a season. Teams that already have matches in it cannot be removed. */
export function setSeasonTeams(ctx: Ctx, input: z.output<typeof seasonTeamsSchema>): SeasonDTO {
  const season = getSeason(ctx, input.seasonId)
  const keep = new Set(input.teams.map((t) => t.teamId))
  tx(ctx, () => {
    for (const t of season.teams) {
      if (keep.has(t.teamId)) continue
      const n =
        ctx.db
          .select({ n: count() })
          .from(matches)
          .where(and(eq(matches.seasonId, input.seasonId), or(eq(matches.homeTeamId, t.teamId), eq(matches.awayTeamId, t.teamId))))
          .get()?.n ?? 0
      if (n > 0) throw new AppError('CONFLICT', `${t.teamName} already has matches in this season and cannot be removed.`)
    }
    ctx.db.delete(seasonTeams).where(eq(seasonTeams.seasonId, input.seasonId)).run()
    for (const t of input.teams) {
      ctx.db.insert(seasonTeams).values({ id: uuid(), seasonId: input.seasonId, teamId: t.teamId, groupName: t.groupName || null }).run()
    }
    audit(ctx, { action: 'seasons.teams', entity: 'seasons', entityId: input.seasonId, before: season.teams, after: input.teams })
  })
  return getSeason(ctx, input.seasonId)
}
