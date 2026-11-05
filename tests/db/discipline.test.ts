import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { auditLogs, suspensions } from '../../src/main/db/schema'
import { clockAction, endPeriod, getLive, recordEvent, recordSanction, setClock, startPeriod, tickClocks, voidEvent } from '../../src/main/services/live'
import { RULE_PRESETS } from '../../src/shared/domain/rules'
import { testDb, type TestDb } from './helpers'
import { fakeTime, readyMatch } from './live-fixture'

let t: TestDb
let time: ReturnType<typeof fakeTime>
beforeEach(() => {
  t = testDb(true)
  time = fakeTime(t)
})
afterEach(() => t.cleanup())

const MIN = 60_000
const rid = () => crypto.randomUUID()
type Kind = 'warning' | 'suspension' | 'disqualification'

const sanction = (matchId: string, kind: Kind, side: 'home' | 'away', rosterId: string, extra: { blueCard?: boolean; acknowledged?: boolean } = {}) =>
  recordSanction(time.ctx(), { matchId, clientRequestId: rid(), kind, side, target: { type: 'player', rosterId }, blueCard: false, acknowledged: false, ...extra })

const official = (matchId: string, kind: Kind, side: 'home' | 'away', teamOfficialId: string, extra: { acknowledged?: boolean } = {}) =>
  recordSanction(time.ctx(), { matchId, clientRequestId: rid(), kind, side, target: { type: 'official', teamOfficialId }, blueCard: false, acknowledged: false, ...extra })

function running() {
  const m = readyMatch(time.ctx())
  startPeriod(time.ctx(), m.matchId)
  clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })
  time.advance(MIN)
  return m
}

const shot = (matchId: string, rosterId: string) =>
  recordEvent(time.ctx(), {
    matchId,
    clientRequestId: rid(),
    event: { kind: 'shot', side: 'home', rosterId, outcome: 'goal', situation: 'positional', zone: null, assistRosterId: null }
  })

const player = (matchId: string, side: 'home' | 'away', jersey: number) => getLive(time.ctx(), matchId)[side].players.find((p) => p.jerseyNumber === jersey)!

describe('warnings', () => {
  it('records a warning and asks before exceeding a rule limit', () => {
    const m = running()
    sanction(m.matchId, 'warning', 'home', m.home.get(5)!)
    expect(player(m.matchId, 'home', 5).warnings).toBe(1)
    expect(() => sanction(m.matchId, 'warning', 'home', m.home.get(5)!)).toThrow(/conflicts with a rule limit/)
    expect(player(m.matchId, 'home', 5).warnings).toBe(1)
    sanction(m.matchId, 'warning', 'home', m.home.get(5)!, { acknowledged: true })
    expect(player(m.matchId, 'home', 5).warnings).toBe(2)
    const logged = t.handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'live.sanction.warning')).all()
    expect(logged.filter((l) => l.note?.startsWith('Acknowledged'))).toHaveLength(1)
  })
})

describe('suspensions', () => {
  it('reduces the team for two minutes of playing time, not real time', () => {
    const m = running()
    const { live } = sanction(m.matchId, 'suspension', 'home', m.home.get(5)!)
    expect(live.home.players.find((p) => p.jerseyNumber === 5)?.status).toBe('suspended')
    expect(live.home).toMatchObject({ onCourt: 6, allowedOnCourt: 6 })
    expect(live.home.reductions[0]).toMatchObject({ label: '#5 P5 HOM', startMs: MIN, endMs: 3 * MIN })
    expect(() => shot(m.matchId, m.home.get(5)!)).toThrow(/serving a suspension/)

    // The timer stops with the match clock.
    clockAction(time.ctx(), { matchId: m.matchId, action: 'stop' })
    time.advance(10 * MIN)
    expect(getLive(time.ctx(), m.matchId).home.reductions).toHaveLength(1)

    clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })
    time.advance(2 * MIN)
    expect(tickClocks(time.ctx())).toEqual([m.matchId])
    const after = getLive(time.ctx(), m.matchId)
    expect(after.home.reductions).toHaveLength(0)
    expect(after.home.players.find((p) => p.jerseyNumber === 5)?.status).toBe('bench')
    expect(after.home).toMatchObject({ onCourt: 6, allowedOnCourt: 7 })
    expect(t.handle.db.select().from(suspensions).get()?.status).toBe('completed')
  })

  it('runs simultaneous suspensions on independent timers', () => {
    const m = running()
    sanction(m.matchId, 'suspension', 'home', m.home.get(5)!)
    time.advance(30_000)
    const { live } = sanction(m.matchId, 'suspension', 'home', m.home.get(6)!)
    expect(live.home.allowedOnCourt).toBe(5)
    expect(live.home.reductions.map((r) => r.endMs)).toEqual([3 * MIN, 3 * MIN + 30_000])
    time.advance(90_000)
    expect(getLive(time.ctx(), m.matchId).home.allowedOnCourt).toBe(6)
  })

  it('lets a team return to strength only when the rules allow it', () => {
    const m = running()
    sanction(m.matchId, 'suspension', 'home', m.home.get(5)!)
    const bringOn = () =>
      recordEvent(time.ctx(), { matchId: m.matchId, clientRequestId: rid(), event: { kind: 'substitution', side: 'home', outRosterId: null, inRosterId: m.home.get(8)! } })
    expect(bringOn).toThrow(/already has 6 players on court/)
    time.advance(2 * MIN)
    expect(bringOn().home.onCourt).toBe(7)
  })

  it('carries a suspension over half-time', () => {
    const m = running()
    time.advance(28 * MIN)
    sanction(m.matchId, 'suspension', 'away', m.away.get(3)!) // 29:00, ends 31:00
    time.advance(2 * MIN)
    tickClocks(time.ctx())
    endPeriod(time.ctx(), { matchId: m.matchId, force: false })
    expect(getLive(time.ctx(), m.matchId).away.reductions).toHaveLength(1)
    startPeriod(time.ctx(), m.matchId)
    clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })
    time.advance(MIN - 1)
    expect(getLive(time.ctx(), m.matchId).away.reductions).toHaveLength(1)
    time.advance(1)
    expect(getLive(time.ctx(), m.matchId).away.reductions).toHaveLength(0)
  })

  it('starts a suspension given in a break when play resumes', () => {
    const m = running()
    time.advance(30 * MIN)
    tickClocks(time.ctx())
    endPeriod(time.ctx(), { matchId: m.matchId, force: false })
    const { live } = sanction(m.matchId, 'suspension', 'home', m.home.get(2)!)
    expect(live.home.reductions[0]).toMatchObject({ startMs: 30 * MIN, endMs: 32 * MIN })
  })

  it('keeps a break sanction in order so it can be voided, even after later play', () => {
    const m = running()
    time.advance(30 * MIN)
    tickClocks(time.ctx())
    endPeriod(time.ctx(), { matchId: m.matchId, force: false })
    const { live } = sanction(m.matchId, 'suspension', 'home', m.home.get(2)!)
    const event = live.events.find((e) => e.type === 'suspension')!
    startPeriod(time.ctx(), m.matchId)
    clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })
    time.advance(5 * MIN)
    sanction(m.matchId, 'suspension', 'home', m.home.get(3)!) // another player: no dependency
    expect(voidEvent(time.ctx(), { matchId: m.matchId, eventId: event.id, reason: 'Wrong player' }).home.players.find((p) => p.jerseyNumber === 2)?.suspensions).toBe(0)
  })

  it('completes a suspension when the clock is stopped just after it expires', () => {
    const m = running()
    sanction(m.matchId, 'suspension', 'home', m.home.get(5)!)
    time.advance(2 * MIN + 10) // expired, but no tick has run yet
    clockAction(time.ctx(), { matchId: m.matchId, action: 'stop' })
    expect(t.handle.db.select().from(suspensions).get()?.status).toBe('completed')
  })

  it('reactivates a finished timer when the clock is corrected backwards', () => {
    const m = running()
    sanction(m.matchId, 'suspension', 'home', m.home.get(5)!)
    time.advance(2 * MIN)
    tickClocks(time.ctx())
    expect(t.handle.db.select().from(suspensions).get()?.status).toBe('completed')
    setClock(time.ctx(), { matchId: m.matchId, ms: 2 * MIN, reason: 'Clock ran on during a stoppage' })
    expect(t.handle.db.select().from(suspensions).get()?.status).toBe('active')
    expect(getLive(time.ctx(), m.matchId).home.reductions).toHaveLength(1)
  })
})

describe('disqualifications', () => {
  it('disqualifies automatically on the third suspension with one team reduction', () => {
    const m = running()
    const id = m.home.get(5)!
    sanction(m.matchId, 'suspension', 'home', id)
    time.advance(2 * MIN)
    sanction(m.matchId, 'suspension', 'home', id)
    time.advance(2 * MIN)
    const { live, notes } = sanction(m.matchId, 'suspension', 'home', id)
    expect(notes.join(' ')).toMatch(/automatic disqualification/)
    expect(live.home.players.find((p) => p.jerseyNumber === 5)?.status).toBe('disqualified')
    expect(live.home.reductions).toHaveLength(1)
    const auto = live.events.find((e) => e.type === 'disqualification')!
    expect(auto).toMatchObject({ automatic: true, correctable: false, text: 'Automatic: suspension number 3' })

    // Undo works on the cause and takes the automatic consequence with it, in order.
    expect(() => voidEvent(time.ctx(), { matchId: m.matchId, eventId: auto.id, reason: 'wrong' })).toThrow(/automatic consequence/)
    const list = live.events.filter((e) => e.type === 'suspension')
    const [third, , first] = list
    expect(() => voidEvent(time.ctx(), { matchId: m.matchId, eventId: first.id, reason: 'wrong' })).toThrow(/later suspension/)
    const undone = voidEvent(time.ctx(), { matchId: m.matchId, eventId: third.id, reason: 'Wrong player' })
    expect(undone.home.players.find((p) => p.jerseyNumber === 5)).toMatchObject({ status: 'bench', suspensions: 2 })
    expect(undone.home.reductions).toHaveLength(0)
    expect(undone.events.find((e) => e.id === auto.id)?.status).toBe('voided')
  })

  it('records a red card with a team reduction and a blue card report', () => {
    const m = running()
    const { live, notes } = sanction(m.matchId, 'disqualification', 'away', m.away.get(4)!, { blueCard: true })
    expect(live.away.reductions[0]).toMatchObject({ kind: 'disqualification', endMs: 3 * MIN })
    expect(live.away.allowedOnCourt).toBe(6)
    expect(live.events[0]).toMatchObject({ type: 'disqualification', blueCard: true })
    expect(notes.join(' ')).toMatch(/written report/)
    time.advance(2 * MIN)
    const after = getLive(time.ctx(), m.matchId)
    expect(after.away.allowedOnCourt).toBe(7)
    expect(after.away.players.find((p) => p.jerseyNumber === 4)?.status).toBe('disqualified')
    expect(() => sanction(m.matchId, 'warning', 'away', m.away.get(4)!)).toThrow(/already disqualified/)
  })

  it('rejects a blue card without a disqualification', () => {
    const m = running()
    expect(() => sanction(m.matchId, 'suspension', 'home', m.home.get(5)!, { blueCard: true })).toThrow(/blue card can only accompany/)
  })

  it('does not reduce the team for a disqualification before the throw-off', () => {
    const m = readyMatch(time.ctx())
    startPeriod(time.ctx(), m.matchId)
    const { live, notes } = sanction(m.matchId, 'disqualification', 'home', m.home.get(5)!)
    expect(live.home.reductions).toHaveLength(0)
    expect(notes.join(' ')).toMatch(/not reduced/)
  })
})

describe('team officials', () => {
  it('reduces the team on court, and a player leaves without a replacement', () => {
    const m = running()
    const a = getLive(time.ctx(), m.matchId).home.officials[0]
    const { live } = official(m.matchId, 'suspension', 'home', a.id)
    expect(live.home).toMatchObject({ onCourt: 7, allowedOnCourt: 6 })
    expect(live.home.officials[0]).toMatchObject({ suspended: true, suspensions: 1 })
    expect(live.home.reductions[0].label).toBe('Official A')
    const off = recordEvent(time.ctx(), { matchId: m.matchId, clientRequestId: rid(), event: { kind: 'substitution', side: 'home', outRosterId: m.home.get(7)!, inRosterId: null } })
    expect(off.home.onCourt).toBe(6)
  })

  it('warns on a second official suspension and refuses a disqualified official', () => {
    const m = running()
    const a = getLive(time.ctx(), m.matchId).home.officials[0]
    official(m.matchId, 'suspension', 'home', a.id)
    expect(() => official(m.matchId, 'suspension', 'home', a.id)).toThrow(/rule limit/)
    official(m.matchId, 'disqualification', 'home', a.id)
    expect(getLive(time.ctx(), m.matchId).home.officials[0].disqualified).toBe(true)
    expect(() => official(m.matchId, 'warning', 'home', a.id)).toThrow(/already disqualified/)
  })
})

describe('shoot-out eligibility', () => {
  const knockout = RULE_PRESETS.find((p) => p.presetId === 'ihf_senior_knockout')!
  const rules = { ...knockout, overtime: { ...knockout.overtime, enabled: false } }
  const toShootout = (suspendAtEnd: boolean) => {
    const m = readyMatch(time.ctx(), rules)
    startPeriod(time.ctx(), m.matchId)
    clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })
    time.advance(31 * MIN)
    tickClocks(time.ctx())
    endPeriod(time.ctx(), { matchId: m.matchId, force: false })
    startPeriod(time.ctx(), m.matchId)
    clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })
    time.advance(29 * MIN + 30_000)
    if (suspendAtEnd) sanction(m.matchId, 'suspension', 'home', m.home.get(5)!)
    time.advance(MIN)
    tickClocks(time.ctx())
    endPeriod(time.ctx(), { matchId: m.matchId, force: false })
    startPeriod(time.ctx(), m.matchId)
    return m
  }
  const throwBy = (matchId: string, rosterId: string) =>
    recordEvent(time.ctx(), { matchId, clientRequestId: rid(), event: { kind: 'shot', side: 'home', rosterId, outcome: 'goal', situation: 'shootout', zone: null, assistRosterId: null } })

  it('excludes a player still suspended at the end of playing time (IHF 2:2)', () => {
    const m = toShootout(true)
    expect(() => throwBy(m.matchId, m.home.get(5)!)).toThrow(/serving a suspension/)
  })

  it('does not reduce the team for a suspension in the shoot-out but excludes the player', () => {
    const m = toShootout(false)
    const { live, notes } = sanction(m.matchId, 'suspension', 'home', m.home.get(6)!)
    expect(live.home.reductions).toHaveLength(0)
    expect(notes.join(' ')).toMatch(/remainder of the shoot-out/)
    expect(() => throwBy(m.matchId, m.home.get(6)!)).toThrow(/rest of the shoot-out/)
  })
})
