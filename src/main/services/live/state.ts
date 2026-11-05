import { and, asc, eq } from 'drizzle-orm'
import type { EventType, Position, ShotOutcome, ShotSituation, ShotZone, Side } from '@shared/domain/constants'
import { shootoutStatus } from '@shared/domain/flow'
import { deriveMatchState, type DerivedMatchState } from '@shared/domain/ledger'
import type { ClockPhase } from '@shared/domain/live'
import { buildPeriodPlan, getPeriod, type PeriodDef } from '@shared/domain/periods'
import type { LedgerEvent, RosterEntry, TeamOfficialEntry } from '@shared/domain/types'
import type { MatchDetailDTO } from '@shared/dto'
import { matchClock, matchEvents, matchRosters, matches, matchTeamOfficials } from '../../db/schema'
import { type Ctx, notFound, nowOf } from '../ctx'
import { getMatch } from '../matches'
import { clockElapsed, type ClockRow } from './clock'

export type EventRow = typeof matchEvents.$inferSelect
export type MatchRow = typeof matches.$inferSelect

/** Everything the live engine needs about one match, loaded in one place. */
export interface LiveData {
  row: MatchRow
  detail: MatchDetailDTO
  plan: PeriodDef[]
  roster: RosterEntry[]
  officials: TeamOfficialEntry[]
  rows: EventRow[]
  events: LedgerEvent[]
  clock: ClockRow
  period: PeriodDef | null
  elapsedMs: number
}

export const toLedger = (e: EventRow): LedgerEvent => ({
  id: e.id,
  seq: e.seq,
  type: e.type as EventType,
  side: e.side,
  rosterId: e.rosterId,
  teamOfficialId: e.teamOfficialId,
  periodSeq: e.periodSeq,
  matchMs: e.matchMs,
  outcome: e.outcome as ShotOutcome | null,
  situation: e.situation as ShotSituation | null,
  zone: e.zone as ShotZone | null,
  assistRosterId: e.assistRosterId,
  goalkeeperRosterId: e.goalkeeperRosterId,
  inRosterId: e.inRosterId,
  blueCard: e.blueCard,
  teamReduction: e.teamReduction,
  causedByEventId: e.causedByEventId,
  reason: e.reason,
  status: e.status
})

function loadRoster(ctx: Ctx, matchId: string): RosterEntry[] {
  return ctx.db
    .select()
    .from(matchRosters)
    .where(eq(matchRosters.matchId, matchId))
    .orderBy(asc(matchRosters.side), asc(matchRosters.jerseyNumber))
    .all()
    .map((r) => ({
      id: r.id,
      side: r.side,
      teamId: r.teamId,
      playerId: r.playerId,
      jersey: r.jerseyNumber,
      name: r.playerName,
      position: (r.position as Position | null) ?? null,
      isGoalkeeper: r.isGoalkeeper,
      isCaptain: r.isCaptain,
      isStarting: r.isStarting,
      isStartingGk: r.isStartingGk,
      photoMediaId: r.photoMediaId
    }))
}

function loadOfficials(ctx: Ctx, matchId: string): TeamOfficialEntry[] {
  return ctx.db
    .select()
    .from(matchTeamOfficials)
    .where(eq(matchTeamOfficials.matchId, matchId))
    .orderBy(asc(matchTeamOfficials.side), asc(matchTeamOfficials.slot))
    .all()
    .map((o) => ({ id: o.id, side: o.side, slot: o.slot, name: o.name, role: o.role }))
}

/** A match that has not started has no clock row yet: it is shown as "before the match". */
const preMatchClock = (matchId: string): ClockRow => ({
  matchId,
  phase: 'pre_match' as ClockPhase,
  periodSeq: 0,
  running: false,
  baseMs: 0,
  runStartedWall: null,
  runStartedMono: null,
  bootId: null,
  checkpointMs: 0,
  checkpointWall: null,
  timeoutId: null,
  updatedAt: 0
})

export function loadLive(ctx: Ctx, matchId: string): LiveData {
  const row = ctx.db.select().from(matches).where(eq(matches.id, matchId)).get() ?? notFound('Match')
  const plan = buildPeriodPlan(row.rules)
  const clock = ctx.db.select().from(matchClock).where(eq(matchClock.matchId, matchId)).get() ?? preMatchClock(matchId)
  const period = clock.periodSeq ? (getPeriod(plan, clock.periodSeq) ?? null) : null
  const rows = ctx.db.select().from(matchEvents).where(eq(matchEvents.matchId, matchId)).orderBy(asc(matchEvents.seq)).all()
  return {
    row,
    detail: getMatch(ctx, matchId),
    plan,
    roster: loadRoster(ctx, matchId),
    officials: loadOfficials(ctx, matchId),
    rows,
    events: rows.map(toLedger),
    clock,
    period,
    elapsedMs: clockElapsed(ctx, clock, period)
  }
}

export interface MatchMoment {
  periodSeq: number
  matchMs: number
}

const suspensionMs = (d: LiveData) => d.row.rules.suspension.durationSeconds * 1000

/** Derived state now (all events, current match time). */
export function stateNow(d: LiveData): DerivedMatchState {
  return deriveMatchState(d.roster, d.officials, d.events, d.elapsedMs, suspensionMs(d))
}

/**
 * Derived state just before a moment of the match, leaving out one event. Used to validate a
 * correction against the situation at the time the corrected event happened.
 */
export function stateBefore(d: LiveData, at: MatchMoment, except: { id: string; seq: number }): DerivedMatchState {
  const before = d.events.filter((e) => {
    if (e.id === except.id) return false
    if (e.periodSeq !== at.periodSeq) return e.periodSeq < at.periodSeq
    if (e.type === 'period_start') return true
    if (e.type === 'period_end') return false
    // Events at the same match time count as "before" only if they were entered earlier.
    return e.matchMs < at.matchMs || (e.matchMs === at.matchMs && e.seq < except.seq)
  })
  return deriveMatchState(d.roster, d.officials, before, at.matchMs, suspensionMs(d))
}

export function currentShootout(d: LiveData) {
  const used = d.period?.kind === 'shootout' || d.events.some((e) => e.situation === 'shootout' && e.status === 'active')
  return used ? shootoutStatus(d.events, d.row.rules) : null
}

export function nextSeq(ctx: Ctx, matchId: string): number {
  const r = ctx.sqlite.prepare('SELECT coalesce(max(seq), 0) AS n FROM match_events WHERE match_id = ?').get(matchId) as { n: number }
  return r.n + 1
}

export function findEvent(ctx: Ctx, matchId: string, eventId: string): EventRow {
  return ctx.db.select().from(matchEvents).where(and(eq(matchEvents.matchId, matchId), eq(matchEvents.id, eventId))).get() ?? notFound('Event')
}

export const scoreOf = (s: DerivedMatchState): Record<Side, number> => ({ home: s.home.score, away: s.away.score })

export type NewEvent = Partial<Omit<EventRow, 'id' | 'matchId' | 'seq' | 'wallTime' | 'recordedBy' | 'status'>> &
  Pick<EventRow, 'type' | 'periodSeq' | 'matchMs'>

/** Append one event to the ledger. The ledger is append-only: events are voided, never deleted. */
export function insertEvent(ctx: Ctx, matchId: string, e: NewEvent): string {
  const id = crypto.randomUUID()
  ctx.db
    .insert(matchEvents)
    .values({ ...e, id, matchId, seq: nextSeq(ctx, matchId), status: 'active', recordedBy: ctx.user?.id ?? null, wallTime: nowOf(ctx) })
    .run()
  return id
}
