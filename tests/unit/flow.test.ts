import { describe, expect, it } from 'vitest'
import { matchResult, nextPeriod, shootoutStatus } from '@shared/domain/flow'
import { buildPeriodPlan, getPeriod } from '@shared/domain/periods'
import { DEFAULT_RULES, RULE_PRESETS } from '@shared/domain/rules'
import { ev } from './fixtures'

const league = DEFAULT_RULES
const knockout = RULE_PRESETS.find((p) => p.presetId === 'ihf_senior_knockout')!
const plan = (r = league) => buildPeriodPlan(r)
const at = (seq: number, r = league) => getPeriod(plan(r), seq)!

describe('period flow', () => {
  it('always plays the second half after the first', () => {
    expect(nextPeriod(plan(), at(1), { home: 3, away: 3 }, league)?.seq).toBe(2)
  })

  it('ends a league match after regular time, even when level', () => {
    expect(nextPeriod(plan(), at(2), { home: 25, away: 25 }, league)).toBeNull()
  })

  it('goes to overtime when a winner is required and the score is level', () => {
    const next = nextPeriod(plan(knockout), at(2, knockout), { home: 25, away: 25 }, knockout)
    expect(next).toMatchObject({ kind: 'overtime', overtime: 1, startMs: 3_600_000 })
  })

  it('ends a knockout match after regular time when there is a winner', () => {
    expect(nextPeriod(plan(knockout), at(2, knockout), { home: 26, away: 25 }, knockout)).toBeNull()
  })

  it('plays both halves of an overtime regardless of the score', () => {
    const p = plan(knockout)
    const ot1a = p.find((x) => x.shortLabel === 'OT1.1')!
    expect(nextPeriod(p, ot1a, { home: 28, away: 26 }, knockout)?.shortLabel).toBe('OT1.2')
  })

  it('goes to a second overtime, then a shoot-out, while level', () => {
    const p = plan(knockout)
    const ot1b = p.find((x) => x.shortLabel === 'OT1.2')!
    const ot2b = p.find((x) => x.shortLabel === 'OT2.2')!
    expect(nextPeriod(p, ot1b, { home: 30, away: 30 }, knockout)?.shortLabel).toBe('OT2.1')
    expect(nextPeriod(p, ot2b, { home: 33, away: 33 }, knockout)?.kind).toBe('shootout')
    expect(nextPeriod(p, ot2b, { home: 34, away: 33 }, knockout)).toBeNull()
  })

  it('goes straight to the shoot-out when overtime is disabled', () => {
    const r = { ...knockout, overtime: { ...knockout.overtime, enabled: false } }
    expect(nextPeriod(plan(r), at(2, r), { home: 20, away: 20 }, r)?.kind).toBe('shootout')
  })

  it('ends after the shoot-out', () => {
    const p = plan(knockout)
    expect(nextPeriod(p, p[p.length - 1], { home: 1, away: 1 }, knockout)).toBeNull()
  })
})

const throwBy = (side: 'home' | 'away', scored: boolean) =>
  ev('shot', { side, outcome: scored ? 'goal' : 'saved', situation: 'shootout', periodSeq: 7 })

describe('penalty shoot-out', () => {
  it('is undecided at the start and alternates turns', () => {
    const s0 = shootoutStatus([], knockout)
    expect(s0).toMatchObject({ decided: false, nextSide: null, suddenDeath: false })
    expect(shootoutStatus([throwBy('home', true)], knockout).nextSide).toBe('away')
  })

  it('is decided early when one team can no longer be caught', () => {
    // home 3/3, away 0/3: away can reach at most 2
    const events = [true, true, true].flatMap((g) => [throwBy('home', g), throwBy('away', false)])
    const s = shootoutStatus(events, knockout)
    expect(s).toMatchObject({ decided: true, winner: 'home' })
  })

  it('goes to sudden death when level after five throws each', () => {
    const events = [1, 2, 3, 4, 5].flatMap(() => [throwBy('home', true), throwBy('away', true)])
    expect(shootoutStatus(events, knockout)).toMatchObject({ decided: false, suddenDeath: true })
    const sd = [...events, throwBy('home', true)]
    expect(shootoutStatus(sd, knockout)).toMatchObject({ decided: false, nextSide: 'away' })
    expect(shootoutStatus([...sd, throwBy('away', false)], knockout)).toMatchObject({ decided: true, winner: 'home' })
  })

  it('ignores voided throws', () => {
    const s = shootoutStatus([{ ...throwBy('home', true), status: 'voided' }], knockout)
    expect(s.home.attempts).toBe(0)
  })
})

describe('match result', () => {
  it('reports regular, overtime and shoot-out decisions', () => {
    const p = plan(knockout)
    expect(matchResult({ home: 25, away: 24 }, at(2), null)).toMatchObject({ winnerSide: 'home', decidedBy: 'regular' })
    expect(matchResult({ home: 25, away: 25 }, at(2), null)).toMatchObject({ winnerSide: 'draw' })
    expect(matchResult({ home: 30, away: 31 }, p.find((x) => x.shortLabel === 'OT1.2')!, null)).toMatchObject({ winnerSide: 'away', decidedBy: 'overtime' })
    const so = shootoutStatus([throwBy('home', false), throwBy('away', true)], { ...knockout, shootout: { enabled: true, throwsPerTeam: 1 } })
    expect(matchResult({ home: 33, away: 33 }, p[p.length - 1], so)).toMatchObject({ winnerSide: 'away', decidedBy: 'shootout', homeShootout: 0, awayShootout: 1 })
  })
})
