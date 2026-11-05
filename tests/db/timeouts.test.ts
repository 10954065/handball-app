import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { matchClock, timeouts } from '../../src/main/db/schema'
import { clockAction, endPeriod, endTimeout, getLive, recordEvent, recordSanction, startPeriod, startTimeout, tickClocks, tickTimeouts, voidEvent } from '../../src/main/services/live'
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
const take = (matchId: string, side: 'home' | 'away' = 'home') => startTimeout(time.ctx(), { matchId, clientRequestId: rid(), side })
const start = (matchId: string) => clockAction(time.ctx(), { matchId, action: 'start' })

function running() {
  const m = readyMatch(time.ctx())
  startPeriod(time.ctx(), m.matchId)
  start(m.matchId)
  time.advance(MIN)
  return m
}

/** Take a time-out and let it finish, then restart the clock and play on. */
function takeAndResume(matchId: string, playMs: number) {
  take(matchId)
  time.advance(60_000)
  tickTimeouts(time.ctx())
  start(matchId)
  time.advance(playMs)
}

function toSecondHalf(matchId: string) {
  time.advance(30 * MIN)
  tickClocks(time.ctx())
  endPeriod(time.ctx(), { matchId, force: false })
  startPeriod(time.ctx(), matchId)
  start(matchId)
}

describe('team time-outs', () => {
  it('stops the clock at once and blocks play until it ends', () => {
    const m = running()
    const live = take(m.matchId)
    expect(live.clock).toMatchObject({ running: false, elapsedMs: MIN })
    expect(live.timeout).toMatchObject({ side: 'home', durationMs: 60_000, elapsedMs: 0 })
    expect(live.events[0]).toMatchObject({ type: 'timeout', side: 'home', matchMs: MIN })
    expect(live.home.timeouts).toMatchObject({ used: 1, remaining: 2, allowed: false })

    expect(() => start(m.matchId)).toThrow(/time-out is in progress/)
    expect(() => take(m.matchId, 'away')).toThrow(/already in progress/)
    const shot = { kind: 'shot' as const, side: 'home' as const, rosterId: m.home.get(5)!, outcome: 'goal' as const, situation: 'positional' as const, zone: null, assistRosterId: null }
    expect(() => recordEvent(time.ctx(), { matchId: m.matchId, clientRequestId: rid(), event: shot })).toThrow(/during a team time-out/)
    expect(() => endPeriod(time.ctx(), { matchId: m.matchId, force: true })).toThrow(/End the team time-out/)
    // Substitutions and sanctions are allowed during a time-out.
    const sub = { kind: 'substitution' as const, side: 'home' as const, outRosterId: m.home.get(5)!, inRosterId: m.home.get(8)! }
    recordEvent(time.ctx(), { matchId: m.matchId, clientRequestId: rid(), event: sub })
    recordSanction(time.ctx(), { matchId: m.matchId, clientRequestId: rid(), kind: 'warning', side: 'away', target: { type: 'player', rosterId: m.away.get(5)! }, blueCard: false, acknowledged: false })
  })

  it('ends by itself after 60 seconds of real time and leaves the clock stopped', () => {
    const m = running()
    take(m.matchId)
    time.advance(59_000)
    expect(tickTimeouts(time.ctx())).toEqual([])
    expect(getLive(time.ctx(), m.matchId).timeout?.elapsedMs).toBe(59_000)
    time.advance(1_000)
    expect(tickTimeouts(time.ctx())).toEqual([m.matchId])
    const live = getLive(time.ctx(), m.matchId)
    expect(live.timeout).toBeNull()
    expect(live.clock.running).toBe(false)
    expect(t.handle.db.select().from(timeouts).get()?.status).toBe('completed')
    expect(start(m.matchId).clock.running).toBe(true)
  })

  it('can be ended early', () => {
    const m = running()
    take(m.matchId)
    time.advance(20_000)
    expect(endTimeout(time.ctx(), m.matchId).timeout).toBeNull()
    expect(() => endTimeout(time.ctx(), m.matchId)).toThrow(/No team time-out/)
  })

  it('refuses a third time-out in the same half', () => {
    const m = running()
    takeAndResume(m.matchId, MIN)
    takeAndResume(m.matchId, MIN)
    expect(() => take(m.matchId)).toThrow(/Only 2 team time-outs/)
    expect(getLive(time.ctx(), m.matchId).home.timeouts).toMatchObject({ used: 2, remaining: 1, allowed: false })
    expect(take(m.matchId, 'away').timeout?.side).toBe('away')
  })

  it('refuses a fourth time-out in the match', () => {
    const m = running()
    takeAndResume(m.matchId, MIN)
    takeAndResume(m.matchId, MIN)
    toSecondHalf(m.matchId)
    time.advance(MIN)
    takeAndResume(m.matchId, MIN)
    expect(() => take(m.matchId)).toThrow(/All 3 team time-outs/)
  })

  it('allows only one time-out in the last five minutes', () => {
    const m = running()
    toSecondHalf(m.matchId)
    time.advance(26 * MIN)
    takeAndResume(m.matchId, MIN)
    expect(() => take(m.matchId)).toThrow(/last 5 minutes/)
  })

  it('refuses a time-out in overtime', () => {
    const rules = RULE_PRESETS.find((p) => p.presetId === 'ihf_senior_knockout')!
    const m = readyMatch(time.ctx(), rules)
    startPeriod(time.ctx(), m.matchId)
    start(m.matchId)
    toSecondHalf(m.matchId)
    time.advance(31 * MIN)
    tickClocks(time.ctx())
    endPeriod(time.ctx(), { matchId: m.matchId, force: false })
    startPeriod(time.ctx(), m.matchId)
    expect(() => take(m.matchId)).toThrow(/not permitted in overtime/)
  })

  it('gives the time-out back when it is voided, including one in progress', () => {
    const m = running()
    const live = take(m.matchId)
    const after = voidEvent(time.ctx(), { matchId: m.matchId, eventId: live.events[0].id, reason: 'Wrong team' })
    expect(after.timeout).toBeNull()
    expect(after.home.timeouts).toMatchObject({ used: 0, remaining: 3 })
    expect(t.handle.db.select().from(timeouts).get()?.status).toBe('voided')
    expect(t.handle.db.select().from(matchClock).where(eq(matchClock.matchId, m.matchId)).get()?.timeoutId).toBeNull()
  })

  it('voiding an earlier time-out leaves a running one alone', () => {
    const m = running()
    const first = take(m.matchId).events[0]
    time.advance(60_000)
    tickTimeouts(time.ctx())
    const endedWall = t.handle.db.select().from(timeouts).get()?.endedWall
    start(m.matchId)
    time.advance(MIN)
    take(m.matchId, 'away')
    const live = voidEvent(time.ctx(), { matchId: m.matchId, eventId: first.id, reason: 'Wrong team' })
    expect(live.timeout?.side).toBe('away')
    expect(() => start(m.matchId)).toThrow(/time-out is in progress/)
    expect(t.handle.db.select().from(timeouts).get()?.endedWall).toBe(endedWall)
  })

  it('ignores a repeated request', () => {
    const m = running()
    const input = { matchId: m.matchId, clientRequestId: rid(), side: 'home' as const }
    startTimeout(time.ctx(), input)
    expect(startTimeout(time.ctx(), input).events.filter((e) => e.type === 'timeout')).toHaveLength(1)
  })

  it('survives a crash: the time-out continues in real time and needs no clock recovery', () => {
    const m = running()
    take(m.matchId)
    time.advance(10_000)
    time.restart(20_000)
    const live = getLive(time.ctx(), m.matchId)
    expect(live.clock.needsRecovery).toBe(false)
    expect(live.timeout?.elapsedMs).toBe(30_000)
    time.advance(30_000)
    expect(tickTimeouts(time.ctx())).toEqual([m.matchId])
  })
})
