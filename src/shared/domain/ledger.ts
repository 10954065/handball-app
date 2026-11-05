import type { Side } from './constants'
import type { CourtStatus, LedgerEvent, ReductionTimer, RosterEntry, TeamOfficialEntry } from './types'

export interface SideState {
  score: number
  shootoutScore: number
  onCourt: Set<string>
  reductions: ReductionTimer[]
}

export interface DerivedMatchState {
  home: SideState
  away: SideState
  /** Score at the end of each period, keyed by period seq. */
  scoreByPeriod: Map<number, { home: number; away: number }>
  courtStatus: Map<string, CourtStatus>
  warnings: Map<string, number>
  suspensions: Map<string, number>
  disqualified: Set<string>
  officialWarnings: Map<string, number>
  officialSuspensions: Map<string, number>
  officialDisqualified: Set<string>
  /** All reduction timers that have been started (active and completed). */
  timers: ReductionTimer[]
}

/** Within a period, period_start comes first and period_end last; otherwise match time, then entry order. */
const boundaryRank = (e: LedgerEvent): number => (e.type === 'period_start' ? 0 : e.type === 'period_end' ? 2 : 1)

/**
 * Chronological order of the ledger. Ordering by match time (not entry order) means a corrected
 * event that replaces an earlier one keeps its place in the match.
 */
export const compareEvents = (a: LedgerEvent, b: LedgerEvent): number =>
  a.periodSeq - b.periodSeq || boundaryRank(a) - boundaryRank(b) || a.matchMs - b.matchMs || a.seq - b.seq

export const activeEvents = (events: readonly LedgerEvent[]): LedgerEvent[] =>
  events.filter((e) => e.status === 'active').sort(compareEvents)

export function isGoal(e: LedgerEvent): boolean {
  return e.type === 'shot' && e.outcome === 'goal'
}

const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

/**
 * Derive the complete match state from the event ledger. The ledger is the single source of
 * truth: score, court presence, sanctions and running suspensions are all recomputed from it.
 */
export function deriveMatchState(
  roster: readonly RosterEntry[],
  _officials: readonly TeamOfficialEntry[],
  events: readonly LedgerEvent[],
  nowMatchMs: number,
  suspensionMs: number
): DerivedMatchState {
  const mk = (side: Side): SideState => ({
    score: 0,
    shootoutScore: 0,
    onCourt: new Set(roster.filter((r) => r.side === side && r.isStarting).map((r) => r.id)),
    reductions: []
  })
  const state: DerivedMatchState = {
    home: mk('home'),
    away: mk('away'),
    scoreByPeriod: new Map(),
    courtStatus: new Map(),
    warnings: new Map(),
    suspensions: new Map(),
    disqualified: new Set(),
    officialWarnings: new Map(),
    officialSuspensions: new Map(),
    officialDisqualified: new Set(),
    timers: []
  }

  for (const e of activeEvents(events)) {
    const side = e.side ? state[e.side] : null
    switch (e.type) {
      case 'shot':
        if (side && e.outcome === 'goal') {
          if (e.situation === 'shootout') side.shootoutScore++
          else side.score++
        }
        break
      case 'warning':
        if (e.rosterId) inc(state.warnings, e.rosterId)
        if (e.teamOfficialId) inc(state.officialWarnings, e.teamOfficialId)
        break
      case 'suspension': {
        let sequence = 0
        if (e.rosterId) {
          inc(state.suspensions, e.rosterId)
          sequence = state.suspensions.get(e.rosterId) ?? 0
          side?.onCourt.delete(e.rosterId)
        }
        if (e.teamOfficialId) {
          inc(state.officialSuspensions, e.teamOfficialId)
          sequence = state.officialSuspensions.get(e.teamOfficialId) ?? 0
        }
        if (e.side && e.teamReduction) {
          state.timers.push({
            eventId: e.id,
            side: e.side,
            kind: 'suspension',
            rosterId: e.rosterId,
            teamOfficialId: e.teamOfficialId,
            sequence,
            startMs: e.matchMs,
            endMs: e.matchMs + suspensionMs
          })
        }
        break
      }
      case 'disqualification':
        if (e.rosterId) {
          state.disqualified.add(e.rosterId)
          side?.onCourt.delete(e.rosterId)
        }
        if (e.teamOfficialId) state.officialDisqualified.add(e.teamOfficialId)
        if (e.side && e.teamReduction) {
          state.timers.push({
            eventId: e.id,
            side: e.side,
            kind: 'disqualification',
            rosterId: e.rosterId,
            teamOfficialId: e.teamOfficialId,
            sequence: 0,
            startMs: e.matchMs,
            endMs: e.matchMs + suspensionMs
          })
        }
        break
      case 'substitution':
        if (side) {
          if (e.rosterId) side.onCourt.delete(e.rosterId)
          if (e.inRosterId) side.onCourt.add(e.inRosterId)
        }
        break
      case 'period_end':
        state.scoreByPeriod.set(e.periodSeq, { home: state.home.score, away: state.away.score })
        break
      default:
        break
    }
  }

  for (const t of state.timers) {
    if (nowMatchMs < t.endMs) state[t.side].reductions.push(t)
  }

  for (const r of roster) {
    const status: CourtStatus = state.disqualified.has(r.id)
      ? 'disqualified'
      : state[r.side].reductions.some((t) => t.rosterId === r.id && t.kind === 'suspension')
        ? 'suspended'
        : state[r.side].onCourt.has(r.id)
          ? 'court'
          : 'bench'
    state.courtStatus.set(r.id, status)
  }
  return state
}

/** Players allowed on court right now for a side, after active team reductions. */
export function allowedOnCourt(state: DerivedMatchState, side: Side, onCourtMax: number): number {
  return Math.max(0, onCourtMax - state[side].reductions.length)
}
