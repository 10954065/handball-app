import { and, asc, count, eq, isNull, like, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { RosterPlayerDTO, TeamDetailDTO, TeamDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import type { teamInputSchema, teamUpdateSchema } from '@shared/schemas/entities'
import { competitions, players, seasons, seasonTeams, teamPlayers, teams } from '../db/schema'
import { audit } from './audit'
import { type Ctx, notFound, nowOf, tx, uuid } from './ctx'

type TeamRow = typeof teams.$inferSelect

// Correlated subquery: the outer column is written out explicitly because Drizzle renders
// columns unqualified in single-table selects.
const activeCount = sql<number>`(SELECT count(*) FROM team_players tp WHERE tp.team_id = "teams"."id" AND tp.left_at IS NULL)`

const toDTO = (t: TeamRow, playerCount: number): TeamDTO => ({
  id: t.id,
  name: t.name,
  shortName: t.shortName,
  code: t.code,
  country: t.country,
  region: t.region,
  clubName: t.clubName,
  homeVenue: t.homeVenue,
  coach: t.coach,
  assistantCoach: t.assistantCoach,
  teamManager: t.teamManager,
  primaryColor: t.primaryColor,
  secondaryColor: t.secondaryColor,
  logoMediaId: t.logoMediaId,
  captainPlayerId: t.captainPlayerId,
  primaryGoalkeeperId: t.primaryGoalkeeperId,
  notes: t.notes,
  archived: t.archived,
  playerCount: Number(playerCount),
  createdAt: t.createdAt
})

export function listTeams(ctx: Ctx, q?: { search?: string; includeArchived?: boolean }): TeamDTO[] {
  const s = q?.search?.trim()
  const where = and(
    q?.includeArchived ? undefined : eq(teams.archived, false),
    s ? or(like(teams.name, `%${s}%`), like(teams.code, `%${s}%`), like(teams.clubName, `%${s}%`), like(teams.region, `%${s}%`)) : undefined
  )
  return ctx.db
    .select({ t: teams, n: activeCount })
    .from(teams)
    .where(where)
    .orderBy(asc(teams.name))
    .all()
    .map((r) => toDTO(r.t, r.n))
}

export function getTeamRow(ctx: Ctx, id: string): TeamRow {
  return ctx.db.select().from(teams).where(eq(teams.id, id)).get() ?? notFound('Team')
}

export function teamRoster(ctx: Ctx, teamId: string): RosterPlayerDTO[] {
  const team = getTeamRow(ctx, teamId)
  return ctx.db
    .select({ p: players, jersey: teamPlayers.jerseyNumber })
    .from(teamPlayers)
    .innerJoin(players, eq(players.id, teamPlayers.playerId))
    .where(and(eq(teamPlayers.teamId, teamId), isNull(teamPlayers.leftAt)))
    .orderBy(asc(teamPlayers.jerseyNumber))
    .all()
    .map(({ p, jersey }) => ({
      playerId: p.id,
      registrationNo: p.registrationNo,
      fullName: `${p.firstName} ${p.lastName}`,
      firstName: p.firstName,
      lastName: p.lastName,
      jerseyNumber: jersey,
      position: p.position,
      isGoalkeeper: p.isGoalkeeper,
      isCaptain: team.captainPlayerId === p.id,
      isPrimaryGoalkeeper: team.primaryGoalkeeperId === p.id,
      photoMediaId: p.photoMediaId,
      registrationStatus: p.registrationStatus,
      dateOfBirth: p.dateOfBirth
    }))
}

export function getTeam(ctx: Ctx, id: string): TeamDetailDTO {
  const t = getTeamRow(ctx, id)
  const roster = teamRoster(ctx, id)
  const comps = ctx.db
    .select({ seasonId: seasons.id, seasonName: seasons.name, competitionId: competitions.id, competitionName: competitions.name, groupName: seasonTeams.groupName })
    .from(seasonTeams)
    .innerJoin(seasons, eq(seasons.id, seasonTeams.seasonId))
    .innerJoin(competitions, eq(competitions.id, seasons.competitionId))
    .where(eq(seasonTeams.teamId, id))
    .all()
  return { ...toDTO(t, roster.length), roster, competitions: comps }
}

function assertDesignations(ctx: Ctx, teamId: string | null, input: { captainPlayerId?: string | null; primaryGoalkeeperId?: string | null }): void {
  for (const [label, pid] of [['captain', input.captainPlayerId], ['primary goalkeeper', input.primaryGoalkeeperId]] as const) {
    if (!pid) continue
    const reg = teamId
      ? ctx.db.select().from(teamPlayers).where(and(eq(teamPlayers.teamId, teamId), eq(teamPlayers.playerId, pid), isNull(teamPlayers.leftAt))).get()
      : undefined
    if (!reg) throw new AppError('VALIDATION', `The ${label} must be a registered player of this team.`)
  }
}

export function createTeam(ctx: Ctx, input: z.output<typeof teamInputSchema>): TeamDetailDTO {
  if (input.captainPlayerId || input.primaryGoalkeeperId) assertDesignations(ctx, null, input)
  const id = uuid()
  tx(ctx, () => {
    ctx.db.insert(teams).values({ ...input, id, createdAt: nowOf(ctx), updatedAt: nowOf(ctx) }).run()
    audit(ctx, { action: 'teams.create', entity: 'teams', entityId: id, after: input })
  })
  return getTeam(ctx, id)
}

export function updateTeam(ctx: Ctx, input: z.output<typeof teamUpdateSchema>): TeamDetailDTO {
  const before = getTeamRow(ctx, input.id)
  assertDesignations(ctx, input.id, input)
  const { id, ...values } = input
  tx(ctx, () => {
    ctx.db.update(teams).set({ ...values, updatedAt: nowOf(ctx) }).where(eq(teams.id, id)).run()
    audit(ctx, { action: 'teams.update', entity: 'teams', entityId: id, before, after: values })
  })
  return getTeam(ctx, id)
}

export function setTeamArchived(ctx: Ctx, id: string, archived: boolean): TeamDTO {
  const before = getTeamRow(ctx, id)
  tx(ctx, () => {
    ctx.db.update(teams).set({ archived, updatedAt: nowOf(ctx) }).where(eq(teams.id, id)).run()
    audit(ctx, { action: archived ? 'teams.archive' : 'teams.restore', entity: 'teams', entityId: id, before: { archived: before.archived } })
  })
  const n = ctx.db.select({ n: count() }).from(teamPlayers).where(and(eq(teamPlayers.teamId, id), isNull(teamPlayers.leftAt))).get()?.n ?? 0
  return toDTO(getTeamRow(ctx, id), n)
}
