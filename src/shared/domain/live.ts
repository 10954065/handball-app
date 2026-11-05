import type { ShotOutcome, ShotSituation, ShotZone, Side } from './constants'
import type { ShootoutStatus } from './flow'
import type { DerivedMatchState } from './ledger'
import type { PeriodDef } from './periods'
import type { RosterEntry } from './types'

export type ClockPhase = 'pre_match' | 'in_period' | 'break' | 'finished'
export type PlayKind = 'technical_fault' | 'turnover' | 'steal' | 'block'
export const PLAY_KINDS: readonly PlayKind[] = ['technical_fault', 'turnover', 'steal', 'block']

export type EventDraft =
  | {
      kind: 'shot'
      side: Side
      rosterId: string
      outcome: ShotOutcome
      situation: ShotSituation
      zone: ShotZone | null
      assistRosterId: string | null
      /** Omitted: the opposing goalkeeper on court is used. Null: unknown or no goalkeeper. */
      goalkeeperRosterId?: string | null
    }
  | { kind: PlayKind; side: Side; rosterId: string | null }
  | { kind: 'substitution'; side: Side; outRosterId: string; inRosterId: string }
  | { kind: 'note'; side: Side | null; text: string }

/** Ledger fields produced from a validated draft. */
export interface EventFields {
  type: 'shot' | PlayKind | 'substitution' | 'note'
  side: Side | null
  rosterId: string | null
  outcome: ShotOutcome | null
  situation: ShotSituation | null
  zone: ShotZone | null
  assistRosterId: string | null
  goalkeeperRosterId: string | null
  inRosterId: string | null
  reason: string | null
}

export interface EventContext {
  roster: readonly RosterEntry[]
  state: DerivedMatchState
  phase: ClockPhase
  period: PeriodDef | null
  shootout: ShootoutStatus | null
}

const blank = (type: EventFields['type'], side: Side | null): EventFields => ({
  type,
  side,
  rosterId: null,
  outcome: null,
  situation: null,
  zone: null,
  assistRosterId: null,
  goalkeeperRosterId: null,
  inRosterId: null,
  reason: null
})

const label = (r: RosterEntry) => `#${r.jersey} ${r.name}`

/** The goalkeeper of a team currently on court, if exactly identifiable. */
export function goalkeeperOnCourt(roster: readonly RosterEntry[], state: DerivedMatchState, side: Side): RosterEntry | null {
  const onCourt = roster.filter((r) => r.side === side && r.isGoalkeeper && state.courtStatus.get(r.id) === 'court')
  return onCourt.find((r) => r.isStartingGk) ?? onCourt[0] ?? null
}

type Result = { errors: string[]; event: EventFields | null }
const fail = (...errors: string[]): Result => ({ errors, event: null })

/**
 * Validate an operator entry against the current match state and turn it into ledger fields.
 * Only facts the system can know are enforced (team membership, disqualification, suspension,
 * court presence for substitutions, shoot-out order). Everything else is the referees' call.
 */
export function validateDraft(d: EventDraft, c: EventContext): Result {
  const find = (id: string | null | undefined) => (id ? c.roster.find((r) => r.id === id) : undefined)
  const own = (id: string, side: Side) => {
    const r = find(id)
    return r && r.side === side ? r : undefined
  }
  const status = (r: RosterEntry) => c.state.courtStatus.get(r.id) ?? 'bench'
  const inPlay = c.phase === 'in_period' && !!c.period

  if (d.kind === 'note') {
    const e = blank('note', d.side)
    return { errors: [], event: { ...e, reason: d.text.trim() } }
  }

  if (d.kind === 'substitution') {
    if (c.phase !== 'in_period' && c.phase !== 'break') return fail('Substitutions can be recorded during a period or a break.')
    if (c.period?.kind === 'shootout') return fail('Substitutions are not recorded during the penalty shoot-out.')
    const out = own(d.outRosterId, d.side)
    const inn = own(d.inRosterId, d.side)
    if (!out || !inn) return fail('Both players must be on this team match sheet.')
    if (out.id === inn.id) return fail('Choose two different players.')
    if (status(out) !== 'court') return fail(`${label(out)} is not on court.`)
    if (status(inn) !== 'bench') return fail(`${label(inn)} cannot come on (${status(inn)}).`)
    return { errors: [], event: { ...blank('substitution', d.side), rosterId: out.id, inRosterId: inn.id } }
  }

  if (!inPlay) return fail('Play events can only be recorded while a period is in progress.')
  const player = d.rosterId ? own(d.rosterId, d.side) : undefined
  if (d.rosterId && !player) return fail('The player is not on this team match sheet.')
  if (player && status(player) === 'disqualified') return fail(`${label(player)} is disqualified.`)

  if (d.kind !== 'shot') {
    if (c.period?.kind === 'shootout') return fail('Only shoot-out throws are recorded during the penalty shoot-out.')
    return { errors: [], event: { ...blank(d.kind, d.side), rosterId: player?.id ?? null } }
  }

  if (!player) return fail('Choose the player who took the shot.')
  if (status(player) === 'suspended') return fail(`${label(player)} is serving a suspension.`)
  return shot(d, player, c, own)
}

function shot(
  d: Extract<EventDraft, { kind: 'shot' }>,
  player: RosterEntry,
  c: EventContext,
  own: (id: string, side: Side) => RosterEntry | undefined
): Result {
  const opp: Side = d.side === 'home' ? 'away' : 'home'
  const shootout = c.period?.kind === 'shootout'
  if (shootout) {
    if (c.shootout?.decided) return fail('The shoot-out has already been decided.')
    if (c.shootout?.nextSide && c.shootout.nextSide !== d.side) return fail('The other team takes the next shoot-out throw.')
  } else if (d.situation === 'shootout') {
    return fail('Shoot-out throws can only be recorded in the penalty shoot-out.')
  }
  const situation: ShotSituation = shootout ? 'shootout' : d.situation
  const onTarget = d.outcome === 'goal' || d.outcome === 'saved'

  let gk: string | null = null
  if (onTarget && situation !== 'empty_goal') {
    if (d.goalkeeperRosterId === undefined) gk = goalkeeperOnCourt(c.roster, c.state, opp)?.id ?? null
    else if (d.goalkeeperRosterId !== null) {
      const g = own(d.goalkeeperRosterId, opp)
      if (!g) return fail('The goalkeeper must belong to the opposing team.')
      gk = g.id
    }
  }

  let assist: string | null = null
  if (d.outcome === 'goal' && d.assistRosterId && !shootout && situation !== 'seven_metre') {
    const a = own(d.assistRosterId, d.side)
    if (!a || a.id === player.id) return fail('The assist must be credited to a team-mate.')
    assist = a.id
  }

  return {
    errors: [],
    event: {
      ...blank('shot', d.side),
      rosterId: player.id,
      outcome: d.outcome,
      situation,
      zone: shootout || situation === 'seven_metre' ? null : d.zone,
      assistRosterId: assist,
      goalkeeperRosterId: gk
    }
  }
}
