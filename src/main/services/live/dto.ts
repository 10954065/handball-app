import { inArray } from 'drizzle-orm'
import type { Side } from '@shared/domain/constants'
import { nextPeriod } from '@shared/domain/flow'
import { activeEvents, allowedOnCourt, compareEvents, type DerivedMatchState } from '@shared/domain/ledger'
import { PLAY_KINDS } from '@shared/domain/live'
import { getPeriod } from '@shared/domain/periods'
import { liveTallies } from '@shared/domain/tally'
import type { LiveEventDTO, LiveEventPlayer, LiveMatchDTO, LiveSideDTO } from '@shared/dto'
import { users } from '../../db/schema'
import { type Ctx, nowOf } from '../ctx'
import { clockView } from './clock'
import { currentShootout, type LiveData, scoreOf, stateNow } from './state'

const EDITABLE = new Set<string>(['shot', ...PLAY_KINDS])
const CORRECTABLE = new Set<string>([...EDITABLE, 'substitution', 'note'])

/** Whether the signed-in user may correct events of this match (finished matches need correct_finalized). */
export function canCorrect(ctx: Ctx, d: LiveData): boolean {
  if (d.row.status === 'finished') return !!ctx.user?.permissions.includes('correct_finalized')
  return d.row.status === 'live'
}

function side(d: LiveData, s: Side, state: DerivedMatchState, tallies: ReturnType<typeof liveTallies>): LiveSideDTO {
  const team = s === 'home' ? d.detail.home : d.detail.away
  const players = d.roster
    .filter((r) => r.side === s)
    .map((r) => {
      const t = tallies.players.get(r.id)
      return {
        rosterId: r.id,
        jerseyNumber: r.jersey,
        name: r.name,
        position: r.position,
        photoMediaId: r.photoMediaId,
        isGoalkeeper: r.isGoalkeeper,
        isCaptain: r.isCaptain,
        status: state.courtStatus.get(r.id) ?? 'bench',
        goals: t?.goals ?? 0,
        shots: t?.shots ?? 0,
        assists: t?.assists ?? 0,
        saves: t?.saves ?? 0,
        shotsFaced: t?.shotsFaced ?? 0
      }
    })
  return {
    side: s,
    teamId: team.teamId,
    name: team.name,
    code: team.code,
    color: team.color,
    logoMediaId: team.logoMediaId,
    score: state[s].score,
    shootoutScore: state[s].shootoutScore,
    players,
    officials: d.officials.filter((o) => o.side === s).map((o) => ({ id: o.id, slot: o.slot, name: o.name, role: o.role })),
    onCourt: players.filter((p) => p.status === 'court').length,
    allowedOnCourt: allowedOnCourt(state, s, d.row.rules.roster.onCourt),
    stats: tallies.teams[s]
  }
}

function events(ctx: Ctx, d: LiveData, correctable: boolean): LiveEventDTO[] {
  const byId = new Map(d.roster.map((r) => [r.id, r]))
  const who = (id: string | null): LiveEventPlayer | null => {
    const r = id ? byId.get(id) : undefined
    return r ? { rosterId: r.id, jerseyNumber: r.jersey, name: r.name } : null
  }
  const userIds = [...new Set(d.rows.map((r) => r.recordedBy).filter((x): x is string => !!x))]
  const names = new Map(
    userIds.length ? ctx.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, userIds)).all().map((u) => [u.id, u.name]) : []
  )
  const running = { home: 0, away: 0 }
  const scoreAfter = new Map<string, { home: number; away: number }>()
  for (const e of activeEvents(d.events)) {
    if (e.type === 'shot' && e.outcome === 'goal' && e.side && e.situation !== 'shootout') {
      running[e.side]++
      scoreAfter.set(e.id, { ...running })
    }
  }
  const rowById = new Map(d.rows.map((r) => [r.id, r]))
  return [...d.events]
    .sort(compareEvents)
    .reverse()
    .map((e) => {
      const r = rowById.get(e.id)!
      return {
        id: e.id,
        seq: e.seq,
        type: e.type,
        side: e.side,
        periodSeq: e.periodSeq,
        periodLabel: getPeriod(d.plan, e.periodSeq)?.shortLabel ?? '',
        matchMs: e.matchMs,
        outcome: e.outcome,
        situation: e.situation,
        zone: e.zone,
        player: who(e.rosterId),
        assist: who(e.assistRosterId),
        goalkeeper: who(e.goalkeeperRosterId),
        inPlayer: who(e.inRosterId),
        text: e.reason,
        status: e.status,
        voidReason: r.voidReason,
        replacesEventId: r.replacesEventId,
        recordedBy: r.recordedBy ? (names.get(r.recordedBy) ?? null) : null,
        wallTime: r.wallTime,
        scoreAfter: scoreAfter.get(e.id) ?? null,
        correctable: correctable && e.status === 'active' && CORRECTABLE.has(e.type),
        editable: correctable && e.status === 'active' && EDITABLE.has(e.type)
      }
    })
}

/** The period that can be started next, if any. */
export function upcomingPeriod(d: LiveData, state: DerivedMatchState) {
  if (d.clock.phase === 'pre_match') return d.plan[0] ?? null
  if (d.clock.phase !== 'break' || !d.period) return null
  return nextPeriod(d.plan, d.period, scoreOf(state), d.row.rules)
}

export function buildLiveDTO(ctx: Ctx, d: LiveData): LiveMatchDTO {
  const state = stateNow(d)
  const tallies = liveTallies(d.events)
  const next = upcomingPeriod(d, state)
  const lastEnd = activeEvents(d.events).filter((e) => e.type === 'period_end').pop()
  const periodScores = d.plan
    .filter((p) => state.scoreByPeriod.has(p.seq) && p.kind !== 'shootout')
    .map((p) => ({ periodSeq: p.seq, label: p.shortLabel, ...state.scoreByPeriod.get(p.seq)! }))
  return {
    match: d.detail,
    plan: d.plan,
    period: d.period,
    nextPeriod: next,
    clock: clockView(ctx, d.clock, d.period),
    home: side(d, 'home', state, tallies),
    away: side(d, 'away', state, tallies),
    events: events(ctx, d, canCorrect(ctx, d)),
    periodScores,
    shootout: currentShootout(d),
    canFinish: d.row.status === 'live' && d.clock.phase === 'break' && next === null,
    breakStartedWall: d.clock.phase === 'break' && lastEnd ? (d.rows.find((r) => r.id === lastEnd.id)?.wallTime ?? null) : null,
    serverWall: nowOf(ctx)
  }
}
