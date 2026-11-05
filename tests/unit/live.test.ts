import { describe, expect, it } from 'vitest'
import { shootoutStatus } from '@shared/domain/flow'
import { deriveMatchState } from '@shared/domain/ledger'
import { goalkeeperOnCourt, validateDraft, type EventContext, type EventDraft } from '@shared/domain/live'
import { buildPeriodPlan } from '@shared/domain/periods'
import { DEFAULT_RULES } from '@shared/domain/rules'
import { liveTallies } from '@shared/domain/tally'
import type { LedgerEvent } from '@shared/domain/types'
import { ev, fullRoster, goal, officialsFixture } from './fixtures'

const roster = fullRoster()
const plan = buildPeriodPlan(DEFAULT_RULES)
const ctx = (events: LedgerEvent[] = [], over: Partial<EventContext> = {}): EventContext => ({
  roster,
  state: deriveMatchState(roster, officialsFixture, events, 600_000, 120_000),
  phase: 'in_period',
  period: plan[0],
  shootout: null,
  onCourtMax: 7,
  timeoutActive: false,
  shootoutExcluded: new Set(),
  ...over
})
const shot = (over: Partial<Extract<EventDraft, { kind: 'shot' }>> = {}): EventDraft => ({
  kind: 'shot',
  side: 'home',
  rosterId: 'home-9',
  outcome: 'goal',
  situation: 'positional',
  zone: 'backcourt',
  assistRosterId: null,
  ...over
})
const sub = (outRosterId: string, inRosterId: string): EventDraft => ({ kind: 'substitution', side: 'home', outRosterId, inRosterId })

describe('live event validation', () => {
  it('credits the opposing goalkeeper on court for shots on target', () => {
    const r = validateDraft(shot({ rosterId: 'home-5' }), ctx())
    expect(r.errors).toEqual([])
    expect(r.event).toMatchObject({ type: 'shot', rosterId: 'home-5', goalkeeperRosterId: 'away-1', outcome: 'goal' })
  })

  it('does not credit a goalkeeper for missed shots or empty-goal goals', () => {
    expect(validateDraft(shot({ rosterId: 'home-5', outcome: 'missed' }), ctx()).event?.goalkeeperRosterId).toBeNull()
    expect(validateDraft(shot({ rosterId: 'home-5', situation: 'empty_goal' }), ctx()).event?.goalkeeperRosterId).toBeNull()
  })

  it('follows a goalkeeper substitution', () => {
    const change = ev('substitution', { side: 'away', rosterId: 'away-1', inRosterId: 'away-12', matchMs: 100 })
    const r2 = roster.map((r) => (r.id === 'away-12' ? { ...r, isGoalkeeper: true } : r))
    const state = deriveMatchState(r2, officialsFixture, [change], 600_000, 120_000)
    expect(goalkeeperOnCourt(r2, state, 'away')?.id).toBe('away-12')
  })

  it('rejects a goalkeeper from the shooting team', () => {
    expect(validateDraft(shot({ rosterId: 'home-5', goalkeeperRosterId: 'home-1' }), ctx()).errors[0]).toMatch(/opposing team/)
  })

  it('keeps assists only for goals by a team-mate', () => {
    expect(validateDraft(shot({ rosterId: 'home-5', assistRosterId: 'home-3' }), ctx()).event?.assistRosterId).toBe('home-3')
    expect(validateDraft(shot({ rosterId: 'home-5', outcome: 'saved', assistRosterId: 'home-3' }), ctx()).event?.assistRosterId).toBeNull()
    expect(validateDraft(shot({ rosterId: 'home-5', assistRosterId: 'home-5' }), ctx()).errors[0]).toMatch(/team-mate/)
    expect(validateDraft(shot({ rosterId: 'home-5', assistRosterId: 'away-3' }), ctx()).errors[0]).toMatch(/team-mate/)
  })

  it('rejects players from the other team, disqualified and suspended players', () => {
    expect(validateDraft(shot({ rosterId: 'away-5' }), ctx()).errors[0]).toMatch(/not on this team/)
    const dq = ev('disqualification', { side: 'home', rosterId: 'home-5', matchMs: 100 })
    expect(validateDraft(shot({ rosterId: 'home-5' }), ctx([dq])).errors[0]).toMatch(/disqualified/)
    const susp = ev('suspension', { teamReduction: true, side: 'home', rosterId: 'home-4', matchMs: 500_000 })
    expect(validateDraft(shot({ rosterId: 'home-4' }), ctx([susp])).errors[0]).toMatch(/suspension/)
  })

  it('records play events only during a period', () => {
    expect(validateDraft(shot(), ctx([], { phase: 'break' })).errors[0]).toMatch(/period is in progress/)
    const r = validateDraft({ kind: 'turnover', side: 'away', rosterId: null }, ctx())
    expect(r.event).toMatchObject({ type: 'turnover', side: 'away', rosterId: null })
  })

  it('validates substitutions against court presence', () => {
    expect(validateDraft(sub('home-3', 'home-10'), ctx()).event).toMatchObject({ type: 'substitution', rosterId: 'home-3', inRosterId: 'home-10' })
    expect(validateDraft(sub('home-10', 'home-11'), ctx()).errors[0]).toMatch(/not on court/)
    expect(validateDraft(sub('home-3', 'home-4'), ctx()).errors[0]).toMatch(/cannot come on/)
    expect(validateDraft(sub('home-3', 'home-10'), ctx([], { phase: 'break' })).errors).toEqual([])
  })

  it('enforces shoot-out rules', () => {
    const so = plan[plan.length - 1]
    const base = { period: so, shootout: shootoutStatus([], DEFAULT_RULES) }
    expect(validateDraft(shot({ situation: 'shootout' }), ctx()).errors[0]).toMatch(/only be recorded in the penalty shoot-out/)
    const r = validateDraft(shot({ assistRosterId: 'home-3', zone: 'wing' }), ctx([], base))
    expect(r.event).toMatchObject({ situation: 'shootout', zone: null, assistRosterId: null })
    const first = ev('shot', { side: 'home', outcome: 'goal', situation: 'shootout' })
    const turn = { ...base, shootout: shootoutStatus([first], DEFAULT_RULES) }
    expect(validateDraft(shot(), ctx([], turn)).errors[0]).toMatch(/other team/)
    expect(validateDraft({ kind: 'steal', side: 'home', rosterId: 'home-3' }, ctx([], base)).errors[0]).toMatch(/shoot-out throws/)
  })
})

describe('live tallies', () => {
  it('counts goals, seven-metres, assists, saves and team totals', () => {
    const events = [
      goal('home', 9, 1000, { assistRosterId: 'home-3', goalkeeperRosterId: 'away-1' }),
      goal('home', 9, 2000, { situation: 'seven_metre', goalkeeperRosterId: 'away-1' }),
      ev('shot', { side: 'home', rosterId: 'home-9', outcome: 'saved', situation: 'seven_metre', goalkeeperRosterId: 'away-1', matchMs: 3000 }),
      ev('shot', { side: 'away', rosterId: 'away-4', outcome: 'missed', situation: 'positional', matchMs: 4000 }),
      ev('turnover', { side: 'away', matchMs: 5000 }),
      goal('home', 9, 6000, { status: 'voided' }),
      ev('shot', { side: 'home', rosterId: 'home-9', outcome: 'goal', situation: 'shootout', periodSeq: 7 })
    ]
    const t = liveTallies(events)
    expect(t.players.get('home-9')).toMatchObject({ goals: 2, shots: 3, sevenMetreGoals: 1, sevenMetreShots: 2 })
    expect(t.players.get('home-3')?.assists).toBe(1)
    expect(t.players.get('away-1')).toMatchObject({ saves: 1, shotsFaced: 3, goalsConceded: 2 })
    expect(t.teams.home).toMatchObject({ goals: 2, shots: 3 })
    expect(t.teams.away).toMatchObject({ saves: 1, shots: 1, turnovers: 1 })
  })
})
