import type { ShotSituation, ShotZone, Side } from './constants'
import { SHOT_SITUATIONS, SHOT_ZONES } from './constants'
import { activeEvents } from './ledger'
import type { PeriodDef } from './periods'
import type { LedgerEvent, RosterEntry } from './types'

/** part as a percentage of whole to one decimal place, or null when there is nothing to measure. */
export function percent(part: number, whole: number): number | null {
  return whole ? Math.round((part / whole) * 1000) / 10 : null
}

export interface ScoreFlowPoint {
  matchMs: number
  home: number
  away: number
  side: Side
}

const isMatchGoal = (e: LedgerEvent) => e.type === 'shot' && e.outcome === 'goal' && e.situation !== 'shootout' && !!e.side

/** The score after each goal, in ledger order. */
export function scoreFlow(events: readonly LedgerEvent[]): ScoreFlowPoint[] {
  const score = { home: 0, away: 0 }
  return activeEvents(events)
    .filter(isMatchGoal)
    .map((e) => {
      const side = e.side as Side
      score[side]++
      return { matchMs: e.matchMs, side, ...score }
    })
}

/** The largest lead either team held, the first time it was reached. */
export function biggestLead(flow: readonly ScoreFlowPoint[]): { side: Side; goals: number } | null {
  let best: { side: Side; goals: number } | null = null
  for (const p of flow) {
    const diff = p.home - p.away
    if (diff !== 0 && Math.abs(diff) > (best?.goals ?? 0)) best = { side: diff > 0 ? 'home' : 'away', goals: Math.abs(diff) }
  }
  return best
}

export interface PeriodScore {
  label: string
  home: number
  away: number
}

/** Goals scored in each period that has at least been started. The shoot-out is reported separately. */
export function goalsByPeriod(events: readonly LedgerEvent[], plan: readonly PeriodDef[]): PeriodScore[] {
  const active = activeEvents(events)
  const started = new Set(active.filter((e) => e.type === 'period_start').map((e) => e.periodSeq))
  return plan
    .filter((p) => p.kind !== 'shootout' && started.has(p.seq))
    .map((p) => {
      const goals = active.filter((e) => isMatchGoal(e) && e.periodSeq === p.seq)
      return { label: p.label, home: goals.filter((e) => e.side === 'home').length, away: goals.filter((e) => e.side === 'away').length }
    })
}

export interface ShootingLine<K extends string> {
  key: K
  shots: number
  goals: number
}

export interface ShootingBreakdown {
  situations: ShootingLine<ShotSituation>[]
  zones: ShootingLine<ShotZone>[]
}

/** A team's shots by situation and zone. Lines without a shot are left out; zones are optional when recording. */
export function shootingBreakdown(events: readonly LedgerEvent[], side: Side): ShootingBreakdown {
  const shots = activeEvents(events).filter((e) => e.type === 'shot' && e.side === side && e.situation !== 'shootout')
  const line = <K extends string>(key: K, of: (e: LedgerEvent) => K | null): ShootingLine<K> => {
    const own = shots.filter((e) => of(e) === key)
    return { key, shots: own.length, goals: own.filter((e) => e.outcome === 'goal').length }
  }
  return {
    situations: SHOT_SITUATIONS.map((s) => line(s, (e) => e.situation)).filter((l) => l.shots > 0),
    zones: SHOT_ZONES.map((z) => line(z, (e) => e.zone)).filter((l) => l.shots > 0)
  }
}

/** Players who took part: in the starting seven, brought on, or named in any active event. */
export function appearances(events: readonly LedgerEvent[], roster: readonly Pick<RosterEntry, 'id' | 'isStarting'>[]): Set<string> {
  const played = new Set(roster.filter((r) => r.isStarting).map((r) => r.id))
  for (const e of activeEvents(events)) {
    for (const id of [e.rosterId, e.inRosterId, e.assistRosterId, e.goalkeeperRosterId]) if (id) played.add(id)
  }
  return played
}
