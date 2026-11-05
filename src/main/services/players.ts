import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { appearances } from '@shared/domain/statistics'
import { liveTallies, type PlayerTally } from '@shared/domain/tally'
import type { PlayerDetailDTO, PlayerDTO, PlayerMatchDTO, PlayerTotalsDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import type { changeJerseySchema, playerInputSchema, playerListQuery, playerUpdateSchema, transferSchema } from '@shared/schemas/entities'
import { competitions, matchEvents, matchRosters, matches, players, teamPlayers, teams } from '../db/schema'
import { audit } from './audit'
import { type Ctx, notFound, nowOf, tx, uuid } from './ctx'
import { toLedger } from './live/state'

type Row = { p: typeof players.$inferSelect; teamId: string | null; teamName: string | null; teamColor: string | null; jersey: number | null; captainId: string | null }

const toDTO = (r: Row): PlayerDTO => ({
  id: r.p.id,
  registrationNo: r.p.registrationNo,
  firstName: r.p.firstName,
  lastName: r.p.lastName,
  fullName: `${r.p.firstName} ${r.p.lastName}`,
  dateOfBirth: r.p.dateOfBirth,
  gender: r.p.gender,
  nationality: r.p.nationality,
  position: r.p.position,
  heightCm: r.p.heightCm,
  isGoalkeeper: r.p.isGoalkeeper,
  photoMediaId: r.p.photoMediaId,
  registrationStatus: r.p.registrationStatus,
  notes: r.p.notes,
  archived: r.p.archived,
  teamId: r.teamId,
  teamName: r.teamName,
  teamColor: r.teamColor,
  jerseyNumber: r.jersey,
  isCaptain: !!r.captainId && r.captainId === r.p.id
})

function baseQuery(ctx: Ctx) {
  return ctx.db
    .select({ p: players, teamId: teams.id, teamName: teams.name, teamColor: teams.primaryColor, jersey: teamPlayers.jerseyNumber, captainId: teams.captainPlayerId })
    .from(players)
    .leftJoin(teamPlayers, and(eq(teamPlayers.playerId, players.id), isNull(teamPlayers.leftAt)))
    .leftJoin(teams, eq(teams.id, teamPlayers.teamId))
}

export function listPlayers(ctx: Ctx, q: z.output<typeof playerListQuery>): PlayerDTO[] {
  const s = q?.search?.trim()
  const num = s && /^\d{1,2}$/.test(s) ? Number(s) : null
  const where = and(
    q?.includeArchived ? undefined : eq(players.archived, false),
    q?.teamId ? eq(teamPlayers.teamId, q.teamId) : undefined,
    q?.position ? eq(players.position, q.position) : undefined,
    q?.freeAgentsOnly ? isNull(teamPlayers.id) : undefined,
    s
      ? or(
          like(sql`${players.firstName} || ' ' || ${players.lastName}`, `%${s}%`),
          like(players.registrationNo, `%${s}%`),
          like(teams.name, `%${s}%`),
          num !== null ? eq(teamPlayers.jerseyNumber, num) : undefined
        )
      : undefined
  )
  return baseQuery(ctx).where(where).orderBy(asc(players.lastName), asc(players.firstName)).all().map(toDTO)
}

export function getPlayerDTO(ctx: Ctx, id: string): PlayerDTO {
  const r = baseQuery(ctx).where(eq(players.id, id)).get()
  return r ? toDTO(r) : notFound('Player')
}

function nextRegistrationNo(ctx: Ctx): string {
  const row = ctx.sqlite
    .prepare("SELECT max(CAST(substr(registration_no, 3) AS INTEGER)) AS n FROM players WHERE registration_no LIKE 'P-%'")
    .get() as { n: number | null }
  return `P-${String((row.n ?? 0) + 1).padStart(6, '0')}`
}

function assertJerseyFree(ctx: Ctx, teamId: string, jersey: number, exceptPlayerId?: string): void {
  const taken = ctx.db
    .select({ playerId: teamPlayers.playerId, first: players.firstName, last: players.lastName })
    .from(teamPlayers)
    .innerJoin(players, eq(players.id, teamPlayers.playerId))
    .where(and(eq(teamPlayers.teamId, teamId), eq(teamPlayers.jerseyNumber, jersey), isNull(teamPlayers.leftAt)))
    .get()
  if (taken && taken.playerId !== exceptPlayerId) {
    throw new AppError('CONFLICT', `Jersey #${jersey} is already worn by ${taken.first} ${taken.last} in this team.`)
  }
}

export function createPlayer(ctx: Ctx, input: z.output<typeof playerInputSchema>): PlayerDTO {
  const { teamId, jerseyNumber, ...values } = input
  if (teamId && !jerseyNumber) throw new AppError('VALIDATION', 'A jersey number is required when registering the player to a team.')
  const id = uuid()
  tx(ctx, () => {
    if (teamId && jerseyNumber) assertJerseyFree(ctx, teamId, jerseyNumber)
    const registrationNo = nextRegistrationNo(ctx)
    ctx.db.insert(players).values({ ...values, id, registrationNo, createdAt: nowOf(ctx), updatedAt: nowOf(ctx) }).run()
    if (teamId && jerseyNumber) {
      ctx.db.insert(teamPlayers).values({ id: uuid(), teamId, playerId: id, jerseyNumber, joinedAt: nowOf(ctx) }).run()
    }
    audit(ctx, { action: 'players.create', entity: 'players', entityId: id, after: { ...values, registrationNo, teamId, jerseyNumber } })
  })
  return getPlayerDTO(ctx, id)
}

export function updatePlayer(ctx: Ctx, input: z.output<typeof playerUpdateSchema>): PlayerDTO {
  const before = ctx.db.select().from(players).where(eq(players.id, input.id)).get() ?? notFound('Player')
  const { id, ...values } = input
  tx(ctx, () => {
    ctx.db.update(players).set({ ...values, updatedAt: nowOf(ctx) }).where(eq(players.id, id)).run()
    audit(ctx, { action: 'players.update', entity: 'players', entityId: id, before, after: values })
  })
  return getPlayerDTO(ctx, id)
}

export function setPlayerArchived(ctx: Ctx, id: string, archived: boolean): PlayerDTO {
  getPlayerDTO(ctx, id)
  tx(ctx, () => {
    ctx.db.update(players).set({ archived, updatedAt: nowOf(ctx) }).where(eq(players.id, id)).run()
    audit(ctx, { action: archived ? 'players.archive' : 'players.restore', entity: 'players', entityId: id })
  })
  return getPlayerDTO(ctx, id)
}

/**
 * Transfer (or release) a player. The current registration is closed, never edited or deleted,
 * so registration history and every played match keep their original team and jersey.
 */
export function transferPlayer(ctx: Ctx, input: z.output<typeof transferSchema>): PlayerDTO {
  const current = getPlayerDTO(ctx, input.playerId)
  if (input.toTeamId && !input.jerseyNumber) throw new AppError('VALIDATION', 'A jersey number is required for the new team.')
  if (input.toTeamId && input.toTeamId === current.teamId) throw new AppError('VALIDATION', 'The player is already registered with this team.')
  const at = input.effectiveDate ? Date.parse(`${input.effectiveDate}T12:00:00Z`) : nowOf(ctx)
  const open = ctx.db.select().from(teamPlayers).where(and(eq(teamPlayers.playerId, input.playerId), isNull(teamPlayers.leftAt))).get()
  if (open && at < open.joinedAt) throw new AppError('VALIDATION', 'The effective date is before the current registration began.')
  tx(ctx, () => {
    if (current.teamId) {
      ctx.db
        .update(teamPlayers)
        .set({ leftAt: at })
        .where(and(eq(teamPlayers.playerId, input.playerId), isNull(teamPlayers.leftAt)))
        .run()
      ctx.db.update(teams).set({ captainPlayerId: null }).where(and(eq(teams.id, current.teamId), eq(teams.captainPlayerId, input.playerId))).run()
      ctx.db.update(teams).set({ primaryGoalkeeperId: null }).where(and(eq(teams.id, current.teamId), eq(teams.primaryGoalkeeperId, input.playerId))).run()
    }
    if (input.toTeamId && input.jerseyNumber) {
      const target = ctx.db.select().from(teams).where(eq(teams.id, input.toTeamId)).get() ?? notFound('Team')
      if (target.archived) throw new AppError('VALIDATION', 'Players cannot be registered to an archived team.')
      assertJerseyFree(ctx, input.toTeamId, input.jerseyNumber)
      ctx.db.insert(teamPlayers).values({ id: uuid(), teamId: input.toTeamId, playerId: input.playerId, jerseyNumber: input.jerseyNumber, joinedAt: at }).run()
    }
    audit(ctx, {
      action: input.toTeamId ? 'players.transfer' : 'players.release',
      entity: 'players',
      entityId: input.playerId,
      before: { teamId: current.teamId, jerseyNumber: current.jerseyNumber },
      after: { teamId: input.toTeamId, jerseyNumber: input.jerseyNumber ?? null }
    })
  })
  return getPlayerDTO(ctx, input.playerId)
}

/** Change the jersey number within the current team (new registration row keeps history exact). */
export function changeJersey(ctx: Ctx, input: z.output<typeof changeJerseySchema>): PlayerDTO {
  const current = getPlayerDTO(ctx, input.playerId)
  if (!current.teamId) throw new AppError('VALIDATION', 'The player is not registered with a team.')
  if (current.jerseyNumber === input.jerseyNumber) return current
  tx(ctx, () => {
    assertJerseyFree(ctx, current.teamId!, input.jerseyNumber, input.playerId)
    const at = nowOf(ctx)
    ctx.db.update(teamPlayers).set({ leftAt: at }).where(and(eq(teamPlayers.playerId, input.playerId), isNull(teamPlayers.leftAt))).run()
    ctx.db.insert(teamPlayers).values({ id: uuid(), teamId: current.teamId!, playerId: input.playerId, jerseyNumber: input.jerseyNumber, joinedAt: at }).run()
    audit(ctx, { action: 'players.jersey', entity: 'players', entityId: input.playerId, before: { jerseyNumber: current.jerseyNumber }, after: { jerseyNumber: input.jerseyNumber } })
  })
  return getPlayerDTO(ctx, input.playerId)
}

const emptyTotals = (): PlayerTotalsDTO => ({
  matches: 0,
  goals: 0,
  sevenMetreGoals: 0,
  shots: 0,
  assists: 0,
  steals: 0,
  turnovers: 0,
  technicalFaults: 0,
  blocks: 0,
  warnings: 0,
  suspensions: 0,
  disqualifications: 0,
  saves: 0,
  shotsFaced: 0
})

function addToTotals(totals: PlayerTotalsDTO, t: PlayerTally): void {
  totals.goals += t.goals
  totals.shots += t.shots
  totals.sevenMetreGoals += t.sevenMetreGoals
  totals.assists += t.assists
  totals.steals += t.steals
  totals.blocks += t.blocks
  totals.turnovers += t.turnovers
  totals.technicalFaults += t.technicalFaults
  totals.warnings += t.warnings
  totals.suspensions += t.suspensions
  totals.disqualifications += t.disqualifications
  totals.saves += t.saves
  totals.shotsFaced += t.shotsFaced
}

/** Player profile. Statistics are derived directly from the active event ledger. */
export function getPlayer(ctx: Ctx, id: string): PlayerDetailDTO {
  const base = getPlayerDTO(ctx, id)
  const history = ctx.db
    .select({ id: teamPlayers.id, teamId: teams.id, teamName: teams.name, jerseyNumber: teamPlayers.jerseyNumber, joinedAt: teamPlayers.joinedAt, leftAt: teamPlayers.leftAt })
    .from(teamPlayers)
    .innerJoin(teams, eq(teams.id, teamPlayers.teamId))
    .where(eq(teamPlayers.playerId, id))
    .orderBy(desc(teamPlayers.joinedAt), desc(teamPlayers.createdAt))
    .all()

  const rosters = ctx.db
    .select({ r: matchRosters, m: matches, competitionName: competitions.name })
    .from(matchRosters)
    .innerJoin(matches, eq(matches.id, matchRosters.matchId))
    .leftJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(eq(matchRosters.playerId, id))
    .orderBy(desc(matches.scheduledAt))
    .all()
  const rosterIds = rosters.map((x) => x.r.id)
  const events = rosterIds.length
    ? ctx.db
        .select()
        .from(matchEvents)
        .where(
          and(
            eq(matchEvents.status, 'active'),
            or(inArray(matchEvents.rosterId, rosterIds), inArray(matchEvents.inRosterId, rosterIds), inArray(matchEvents.assistRosterId, rosterIds), inArray(matchEvents.goalkeeperRosterId, rosterIds))
          )
        )
        .all()
    : []

  const totals = emptyTotals()
  const perMatch = new Map<string, PlayerMatchDTO>()
  for (const { r, m } of rosters) {
    perMatch.set(r.id, {
      matchId: m.id,
      matchNumber: m.matchNumber,
      scheduledAt: m.scheduledAt,
      status: m.status,
      teamName: r.side === 'home' ? m.homeTeamName : m.awayTeamName,
      opponentName: r.side === 'home' ? m.awayTeamName : m.homeTeamName,
      jerseyNumber: r.jerseyNumber,
      isStarting: r.isStarting,
      goals: 0,
      shots: 0,
      warnings: 0,
      suspensions: 0,
      disqualifications: 0
    })
  }
  const ledger = events.map(toLedger)
  const { players: tallies } = liveTallies(ledger)
  const played = appearances(ledger, rosters.map((x) => ({ id: x.r.id, isStarting: x.r.isStarting })))
  const finished = new Set(rosters.filter((x) => x.m.status === 'finished').map((x) => x.r.id))
  totals.matches = [...finished].filter((id) => played.has(id)).length
  for (const [rosterId, t] of tallies) {
    const own = perMatch.get(rosterId)
    if (!own) continue
    own.goals = t.goals
    own.shots = t.shots
    own.warnings = t.warnings
    own.suspensions = t.suspensions
    own.disqualifications = t.disqualifications
    // Career totals cover finalized matches, like the statistics page; a live match shows in its own row.
    if (finished.has(rosterId)) addToTotals(totals, t)
  }
  const competitionsPlayed = [...new Set(rosters.map((x) => x.competitionName).filter((n): n is string => !!n))]
  return { ...base, history, matches: [...perMatch.values()], totals, competitions: competitionsPlayed }
}
