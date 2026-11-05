import { describe, expect, it } from 'vitest'
import { planSanction, type SanctionRequest } from '@shared/domain/discipline'
import { deriveMatchState } from '@shared/domain/ledger'
import { DEFAULT_RULES } from '@shared/domain/rules'
import type { LedgerEvent } from '@shared/domain/types'
import { ev, fullRoster, officialsFixture } from './fixtures'

const roster = fullRoster()
const plan = (req: Partial<SanctionRequest> & Pick<SanctionRequest, 'kind'>, events: LedgerEvent[] = []) =>
  planSanction(
    { side: 'home', target: { type: 'player', rosterId: 'home-5' }, context: 'in_play', ...req },
    deriveMatchState(roster, officialsFixture, events, 1_000_000, 120_000),
    roster,
    officialsFixture,
    DEFAULT_RULES
  )
const susp = (rosterId: string, matchMs = 100_000) => ev('suspension', { teamReduction: true, side: 'home', rosterId, matchMs })

describe('disciplinary engine', () => {
  it('first warning is recorded without consequences', () => {
    const p = plan({ kind: 'warning' })
    expect(p.errors).toEqual([])
    expect(p.warnings).toEqual([])
    expect(p.events).toEqual([{ type: 'warning', teamReduction: false, blueCard: false, automatic: false }])
  })

  it('a second warning for the same player raises a rule warning (IHF 16:1) but no automatic punishment', () => {
    const p = plan({ kind: 'warning' }, [ev('warning', { side: 'home', rosterId: 'home-5' })])
    expect(p.warnings.join(' ')).toMatch(/only one warning/)
    expect(p.events).toHaveLength(1)
    expect(p.events[0].type).toBe('warning')
  })

  it('a warning after a suspension raises a rule warning', () => {
    expect(plan({ kind: 'warning' }, [susp('home-5')]).warnings.join(' ')).toMatch(/should not follow a suspension/)
  })

  it('a fourth team player warning raises a rule warning', () => {
    const events = ['home-2', 'home-3', 'home-4'].map((id) => ev('warning', { side: 'home', rosterId: id }))
    expect(plan({ kind: 'warning' }, events).warnings.join(' ')).toMatch(/3 warnings/)
  })

  it('first and second suspensions reduce the team and carry their sequence number', () => {
    const first = plan({ kind: 'suspension' })
    expect(first.sequence).toBe(1)
    expect(first.events).toEqual([{ type: 'suspension', teamReduction: true, blueCard: false, automatic: false }])
    const second = plan({ kind: 'suspension' }, [susp('home-5')])
    expect(second.sequence).toBe(2)
    expect(second.events).toHaveLength(1)
  })

  it('the third suspension automatically disqualifies without a second team reduction (IHF 16:6 d)', () => {
    const p = plan({ kind: 'suspension' }, [susp('home-5', 100_000), susp('home-5', 400_000)])
    expect(p.sequence).toBe(3)
    expect(p.events).toEqual([
      { type: 'suspension', teamReduction: true, blueCard: false, automatic: false },
      { type: 'disqualification', teamReduction: false, blueCard: false, automatic: true }
    ])
    expect(p.notes.join(' ')).toMatch(/automatic disqualification/)
  })

  it('a direct red card disqualifies with a two-minute team reduction', () => {
    const p = plan({ kind: 'disqualification' })
    expect(p.events).toEqual([{ type: 'disqualification', teamReduction: true, blueCard: false, automatic: false }])
    expect(p.reportRequired).toBe(false)
  })

  it('a blue card flags a written report and adds no extra punishment', () => {
    const p = plan({ kind: 'disqualification', blueCard: true })
    expect(p.reportRequired).toBe(true)
    expect(p.events).toHaveLength(1)
    expect(p.notes.join(' ')).toMatch(/written report/)
  })

  it('a blue card without a disqualification is rejected', () => {
    expect(plan({ kind: 'suspension', blueCard: true }).errors).not.toEqual([])
  })

  it('a disqualified player cannot be sanctioned again', () => {
    const p = plan({ kind: 'suspension' }, [ev('disqualification', { side: 'home', rosterId: 'home-5' })])
    expect(p.errors.join(' ')).toMatch(/already disqualified/)
    expect(p.events).toEqual([])
  })

  it('rejects a player who is not on this team match roster', () => {
    expect(plan({ kind: 'warning', target: { type: 'player', rosterId: 'away-5' } }).errors).not.toEqual([])
  })

  it('no team reduction during the shoot-out or before the match', () => {
    expect(plan({ kind: 'suspension', context: 'shootout' }).events[0].teamReduction).toBe(false)
    expect(plan({ kind: 'disqualification', context: 'pre_match' }).events[0].teamReduction).toBe(false)
  })

  it('team officials: one warning and one suspension in total, further ones are flagged', () => {
    const official = (id: string) => ({ type: 'official' as const, teamOfficialId: id })
    expect(plan({ kind: 'warning', target: official('home-A') }).warnings).toEqual([])
    const warned = [ev('warning', { side: 'home', teamOfficialId: 'home-A' })]
    expect(plan({ kind: 'warning', target: official('home-B') }, warned).warnings.join(' ')).toMatch(/team officials/)
    expect(plan({ kind: 'suspension', target: official('home-A') }).events[0]).toMatchObject({ type: 'suspension', teamReduction: true })
    const suspended = [ev('suspension', { teamReduction: true, side: 'home', teamOfficialId: 'home-A' })]
    expect(plan({ kind: 'suspension', target: official('home-B') }, suspended).warnings.join(' ')).toMatch(/disqualification/)
  })
})
