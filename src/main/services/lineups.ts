import { and, asc, eq, isNull } from 'drizzle-orm'
import type { z } from 'zod'
import type { Side } from '@shared/domain/constants'
import { validateLineup } from '@shared/domain/lineup'
import type { LineupEntryDTO, MatchSetupDTO, SideSetupDTO, SquadPlayerDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import type { saveLineupSchema } from '@shared/schemas/lineup'
import { matchEvents, matchLineups, matchRosters, matches, matchTeamOfficials, players, teamPlayers, teams, users } from '../db/schema'
import { audit } from './audit'
import { type Ctx, notFound, nowOf, requireUser, tx, uuid } from './ctx'
import { getMatch } from './matches'

const EDITABLE = new Set(['scheduled', 'ready'])

function squad(ctx: Ctx, teamId: string): SquadPlayerDTO[] {
  const team = ctx.db.select().from(teams).where(eq(teams.id, teamId)).get() ?? notFound('Team')
  return ctx.db
    .select({ p: players, jersey: teamPlayers.jerseyNumber })
    .from(teamPlayers)
    .innerJoin(players, eq(players.id, teamPlayers.playerId))
    .where(and(eq(teamPlayers.teamId, teamId), isNull(teamPlayers.leftAt)))
    .orderBy(asc(teamPlayers.jerseyNumber))
    .all()
    .map(({ p, jersey }) => {
      const reason = p.archived ? 'Archived' : p.registrationStatus !== 'registered' ? `Registration ${p.registrationStatus}` : null
      return {
        playerId: p.id,
        fullName: `${p.firstName} ${p.lastName}`,
        jerseyNumber: jersey,
        position: p.position,
        isGoalkeeper: p.isGoalkeeper,
        photoMediaId: p.photoMediaId,
        isTeamCaptain: team.captainPlayerId === p.id,
        isPrimaryGoalkeeper: team.primaryGoalkeeperId === p.id,
        eligible: reason === null,
        ineligibleReason: reason
      }
    })
}

function entries(ctx: Ctx, matchId: string, side: Side): LineupEntryDTO[] {
  return ctx.db
    .select()
    .from(matchRosters)
    .where(and(eq(matchRosters.matchId, matchId), eq(matchRosters.side, side)))
    .orderBy(asc(matchRosters.jerseyNumber))
    .all()
    .map((r) => ({
      rosterId: r.id,
      playerId: r.playerId,
      jerseyNumber: r.jerseyNumber,
      name: r.playerName,
      position: (r.position as LineupEntryDTO['position']) ?? null,
      photoMediaId: r.photoMediaId,
      isGoalkeeper: r.isGoalkeeper,
      isStarting: r.isStarting,
      isStartingGk: r.isStartingGk,
      isCaptain: r.isCaptain
    }))
}

function sideSetup(ctx: Ctx, matchId: string, side: Side): SideSetupDTO {
  const m = ctx.db.select().from(matches).where(eq(matches.id, matchId)).get() ?? notFound('Match')
  const teamId = side === 'home' ? m.homeTeamId : m.awayTeamId
  const team = ctx.db.select().from(teams).where(eq(teams.id, teamId)).get() ?? notFound('Team')
  const lineup = ctx.db
    .select({ confirmedAt: matchLineups.confirmedAt, by: users.displayName })
    .from(matchLineups)
    .leftJoin(users, eq(users.id, matchLineups.confirmedBy))
    .where(and(eq(matchLineups.matchId, matchId), eq(matchLineups.side, side)))
    .get()
  const list = entries(ctx, matchId, side)
  const officials = ctx.db
    .select({ id: matchTeamOfficials.id, slot: matchTeamOfficials.slot, name: matchTeamOfficials.name, role: matchTeamOfficials.role })
    .from(matchTeamOfficials)
    .where(and(eq(matchTeamOfficials.matchId, matchId), eq(matchTeamOfficials.side, side)))
    .orderBy(asc(matchTeamOfficials.slot))
    .all()
  const validation = list.length
    ? validateLineup(list.map((e) => ({ ...e, jersey: e.jerseyNumber })), m.rules)
    : { errors: ['The match sheet has not been prepared.'], warnings: [] }
  return {
    side,
    teamId,
    teamName: side === 'home' ? m.homeTeamName : m.awayTeamName,
    code: team.code,
    color: side === 'home' ? m.homeColor : m.awayColor,
    logoMediaId: team.logoMediaId,
    coach: team.coach,
    assistantCoach: team.assistantCoach,
    teamManager: team.teamManager,
    squad: squad(ctx, teamId),
    entries: list,
    officials,
    confirmedAt: lineup?.confirmedAt ?? null,
    confirmedBy: lineup?.by ?? null,
    validation: { errors: validation.errors, warnings: validation.warnings }
  }
}

export function getMatchSetup(ctx: Ctx, matchId: string): MatchSetupDTO {
  const match = getMatch(ctx, matchId)
  return { match, locked: !EDITABLE.has(match.status), home: sideSetup(ctx, matchId, 'home'), away: sideSetup(ctx, matchId, 'away') }
}

/** Errors that only mean "not finished yet" do not block saving a draft; they block confirmation. */
const isDraftOnly = (e: string) => /^At least \d+ starting players/.test(e)

function assertEditable(ctx: Ctx, matchId: string): typeof matches.$inferSelect {
  const m = ctx.db.select().from(matches).where(eq(matches.id, matchId)).get() ?? notFound('Match')
  const started = ctx.db.select({ id: matchEvents.id }).from(matchEvents).where(eq(matchEvents.matchId, matchId)).limit(1).get()
  if (!EDITABLE.has(m.status) || started) throw new AppError('CONFLICT', 'The match has started. The match sheet can no longer be changed here.')
  return m
}

function upsertLineup(ctx: Ctx, matchId: string, side: Side, teamId: string, confirmed: boolean): void {
  const at = nowOf(ctx)
  const values = { confirmedAt: confirmed ? at : null, confirmedBy: confirmed ? (ctx.user?.id ?? null) : null, updatedAt: at }
  const existing = ctx.db.select().from(matchLineups).where(and(eq(matchLineups.matchId, matchId), eq(matchLineups.side, side))).get()
  if (existing) ctx.db.update(matchLineups).set(values).where(eq(matchLineups.id, existing.id)).run()
  else ctx.db.insert(matchLineups).values({ id: uuid(), matchId, side, teamId, ...values, createdAt: at }).run()
}

function syncStatus(ctx: Ctx, matchId: string): void {
  const rows = ctx.db.select().from(matchLineups).where(eq(matchLineups.matchId, matchId)).all()
  const ready = rows.length === 2 && rows.every((r) => r.confirmedAt)
  ctx.db.update(matches).set({ status: ready ? 'ready' : 'scheduled', updatedAt: nowOf(ctx) }).where(eq(matches.id, matchId)).run()
}

/**
 * Save the match sheet for one team as a snapshot (name, position, photo, designations).
 * Later edits to the club roster never change this snapshot. Saving clears a confirmation.
 */
export function saveLineup(ctx: Ctx, input: z.output<typeof saveLineupSchema>): MatchSetupDTO {
  requireUser(ctx)
  const m = assertEditable(ctx, input.matchId)
  const teamId = input.side === 'home' ? m.homeTeamId : m.awayTeamId
  const available = new Map(squad(ctx, teamId).map((p) => [p.playerId, p]))
  for (const e of input.entries) {
    const p = available.get(e.playerId)
    if (!p) throw new AppError('VALIDATION', 'A selected player is not registered with this team.')
    if (!p.eligible) throw new AppError('VALIDATION', `${p.fullName} is not eligible (${p.ineligibleReason}).`)
  }
  const v = validateLineup(input.entries.map((e) => ({ ...e, jersey: e.jerseyNumber, isGoalkeeper: available.get(e.playerId)!.isGoalkeeper })), m.rules)
  const blocking = v.errors.filter((e) => !isDraftOnly(e))
  if (blocking.length) throw new AppError('VALIDATION', 'The match sheet is not valid.', blocking)
  if (input.officials.length > m.rules.roster.maxOfficials) throw new AppError('VALIDATION', `At most ${m.rules.roster.maxOfficials} team officials are allowed.`)
  if (new Set(input.officials.map((o) => o.slot)).size !== input.officials.length) throw new AppError('VALIDATION', 'Each team official slot (A-D) can be used once.')

  tx(ctx, () => {
    ctx.db.delete(matchRosters).where(and(eq(matchRosters.matchId, input.matchId), eq(matchRosters.side, input.side))).run()
    ctx.db.delete(matchTeamOfficials).where(and(eq(matchTeamOfficials.matchId, input.matchId), eq(matchTeamOfficials.side, input.side))).run()
    for (const e of input.entries) {
      const p = ctx.db.select().from(players).where(eq(players.id, e.playerId)).get()!
      ctx.db
        .insert(matchRosters)
        .values({
          id: uuid(),
          matchId: input.matchId,
          side: input.side,
          teamId,
          playerId: p.id,
          jerseyNumber: e.jerseyNumber,
          playerName: `${p.firstName} ${p.lastName}`,
          position: p.position,
          photoMediaId: p.photoMediaId,
          isGoalkeeper: p.isGoalkeeper || e.isStartingGk,
          isCaptain: e.isCaptain,
          isStarting: e.isStarting,
          isStartingGk: e.isStartingGk
        })
        .run()
    }
    for (const o of input.officials) {
      ctx.db.insert(matchTeamOfficials).values({ id: uuid(), matchId: input.matchId, side: input.side, slot: o.slot, name: o.name, role: o.role }).run()
    }
    upsertLineup(ctx, input.matchId, input.side, teamId, false)
    syncStatus(ctx, input.matchId)
    audit(ctx, {
      action: 'lineups.save',
      entity: 'match_rosters',
      entityId: input.matchId,
      matchId: input.matchId,
      after: { side: input.side, players: input.entries.length, starters: v.starters, officials: input.officials.length }
    })
  })
  return getMatchSetup(ctx, input.matchId)
}

export function confirmLineup(ctx: Ctx, input: { matchId: string; side: Side }): MatchSetupDTO {
  requireUser(ctx)
  const m = assertEditable(ctx, input.matchId)
  const side = sideSetup(ctx, input.matchId, input.side)
  if (side.validation.errors.length) throw new AppError('VALIDATION', 'The lineup cannot be confirmed yet.', side.validation.errors)
  tx(ctx, () => {
    upsertLineup(ctx, input.matchId, input.side, input.side === 'home' ? m.homeTeamId : m.awayTeamId, true)
    syncStatus(ctx, input.matchId)
    audit(ctx, { action: 'lineups.confirm', entity: 'match_lineups', entityId: input.matchId, matchId: input.matchId, after: { side: input.side } })
  })
  return getMatchSetup(ctx, input.matchId)
}

export function reopenLineup(ctx: Ctx, input: { matchId: string; side: Side }): MatchSetupDTO {
  requireUser(ctx)
  const m = assertEditable(ctx, input.matchId)
  tx(ctx, () => {
    upsertLineup(ctx, input.matchId, input.side, input.side === 'home' ? m.homeTeamId : m.awayTeamId, false)
    syncStatus(ctx, input.matchId)
    audit(ctx, { action: 'lineups.reopen', entity: 'match_lineups', entityId: input.matchId, matchId: input.matchId, after: { side: input.side } })
  })
  return getMatchSetup(ctx, input.matchId)
}
