import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { RULE_PRESETS } from '../../src/shared/domain/rules'
import type { SessionUser } from '../../src/shared/dto'
import { ROLE_PERMISSIONS } from '../../src/shared/domain/constants'
import { auditLogs, matches, matchEvents, substitutions } from '../../src/main/db/schema'
import { saveLineup } from '../../src/main/services/lineups'
import {
  clockAction,
  editEvent,
  endPeriod,
  finishMatch,
  getLive,
  recordEvent,
  recoverClock,
  setClock,
  startPeriod,
  stopAllClocks,
  tickClocks,
  voidEvent
} from '../../src/main/services/live'
import { insertEvent } from '../../src/main/services/live/state'
import { assertNoLiveMatch } from '../../src/main/services/matches'
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
const OPERATOR: SessionUser = { id: '00000000-0000-4000-8000-000000000002', username: 'op', displayName: 'Op', role: 'operator', permissions: [...ROLE_PERMISSIONS.operator] }

function goal(matchId: string, side: 'home' | 'away', rosterId: string, extra: Record<string, unknown> = {}) {
  return recordEvent(time.ctx(), {
    matchId,
    clientRequestId: rid(),
    event: { kind: 'shot', side, rosterId, outcome: 'goal', situation: 'positional', zone: null, assistRosterId: null, ...extra }
  })
}

/** Play a period to its end: start the clock, let the time run out, end the period. */
function playOut(matchId: string) {
  clockAction(time.ctx(), { matchId, action: 'start' })
  time.advance(31 * MIN)
  tickClocks(time.ctx())
  return endPeriod(time.ctx(), { matchId, force: false })
}

describe('live match engine', () => {
  it('records a complete match with accurate times, score and result', () => {
    const m = readyMatch(time.ctx())
    let live = startPeriod(time.ctx(), m.matchId)
    expect(live.match.status).toBe('live')
    expect(live.clock).toMatchObject({ phase: 'in_period', periodSeq: 1, running: false, elapsedMs: 0 })

    clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })
    time.advance(10 * MIN + 250)
    live = goal(m.matchId, 'home', m.home.get(5)!)
    const g = live.events.find((e) => e.type === 'shot')!
    expect(g).toMatchObject({ matchMs: 10 * MIN + 250, scoreAfter: { home: 1, away: 0 } })
    expect(g.goalkeeper?.jerseyNumber).toBe(1)
    expect(live.home.score).toBe(1)
    expect(live.home.players.find((p) => p.jerseyNumber === 5)?.goals).toBe(1)
    expect(live.away.players.find((p) => p.jerseyNumber === 1)?.shotsFaced).toBe(1)

    // The clock never runs past the end of the period.
    time.advance(25 * MIN)
    expect(tickClocks(time.ctx())).toEqual([m.matchId])
    expect(t.handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'live.clock.autostop')).all()).toHaveLength(1)
    live = getLive(time.ctx(), m.matchId)
    expect(live.clock).toMatchObject({ running: false, elapsedMs: 30 * MIN })
    expect(() => clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })).toThrow(/playing time of this period is over/)

    live = endPeriod(time.ctx(), { matchId: m.matchId, force: false })
    expect(live.clock.phase).toBe('break')
    expect(live.nextPeriod?.seq).toBe(2)
    expect(live.periodScores).toEqual([{ periodSeq: 1, label: '1H', home: 1, away: 0 }])

    live = startPeriod(time.ctx(), m.matchId)
    expect(live.clock).toMatchObject({ periodSeq: 2, elapsedMs: 30 * MIN })
    clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })
    time.advance(5 * MIN)
    goal(m.matchId, 'away', m.away.get(9)!)
    goal(m.matchId, 'away', m.away.get(9)!)
    time.advance(26 * MIN)
    tickClocks(time.ctx())
    live = endPeriod(time.ctx(), { matchId: m.matchId, force: false })
    expect(live).toMatchObject({ canFinish: true, nextPeriod: null })

    live = finishMatch(time.ctx(), { matchId: m.matchId, force: false })
    const row = t.handle.db.select().from(matches).where(eq(matches.id, m.matchId)).get()!
    expect(row).toMatchObject({ status: 'finished', homeScore: 1, awayScore: 2, homeHalfTime: 1, awayHalfTime: 0, winnerSide: 'away', decidedBy: 'regular' })
    expect(live.clock.phase).toBe('finished')
    expect(() => goal(m.matchId, 'home', m.home.get(5)!)).toThrow(/not in progress/)
  })

  it('ignores a repeated submission with the same request id', () => {
    const m = readyMatch(time.ctx())
    startPeriod(time.ctx(), m.matchId)
    const input = { matchId: m.matchId, clientRequestId: rid(), event: { kind: 'turnover' as const, side: 'home' as const, rosterId: null } }
    recordEvent(time.ctx(), input)
    const live = recordEvent(time.ctx(), input)
    expect(live.events.filter((e) => e.type === 'turnover')).toHaveLength(1)
  })

  it('locks the match sheet once the match has started', () => {
    const m = readyMatch(time.ctx())
    startPeriod(time.ctx(), m.matchId)
    expect(() => saveLineup(time.ctx(), { matchId: m.matchId, side: 'home', entries: [], officials: [] })).toThrow(/has started/)
  })

  it('asks for confirmation before ending a period early', () => {
    const m = readyMatch(time.ctx())
    startPeriod(time.ctx(), m.matchId)
    clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })
    time.advance(MIN)
    expect(() => endPeriod(time.ctx(), { matchId: m.matchId, force: false })).toThrow(/Stop the clock/)
    clockAction(time.ctx(), { matchId: m.matchId, action: 'stop' })
    expect(() => endPeriod(time.ctx(), { matchId: m.matchId, force: false })).toThrow(/29:00 of playing time remain/)
    expect(endPeriod(time.ctx(), { matchId: m.matchId, force: true }).clock.phase).toBe('break')
  })
})

describe('clock recovery and correction', () => {
  it('detects a clock left running by a crashed process and resumes from the chosen time', () => {
    const m = readyMatch(time.ctx())
    startPeriod(time.ctx(), m.matchId)
    clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })
    time.advance(12 * MIN + 400)
    tickClocks(time.ctx()) // writes a checkpoint
    time.advance(700) // not yet checkpointed when the process dies

    time.restart(90_000)
    let live = getLive(time.ctx(), m.matchId)
    expect(live.clock).toMatchObject({ running: false, needsRecovery: true, elapsedMs: 12 * MIN + 400 })
    expect(live.clock.recovery).toMatchObject({ checkpointMs: 12 * MIN + 400, wallElapsedMs: 90_700 })
    expect(() => goal(m.matchId, 'home', m.home.get(5)!)).toThrow(/Recover the match clock/)
    expect(() => clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })).toThrow(/Recover/)

    live = recoverClock(time.ctx(), { matchId: m.matchId, resumeAtMs: 12 * MIN + 30_000 })
    expect(live.clock).toMatchObject({ running: false, needsRecovery: false, elapsedMs: 12 * MIN + 30_000 })
    clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })
    time.advance(1000)
    expect(getLive(time.ctx(), m.matchId).clock.elapsedMs).toBe(12 * MIN + 31_000)
    expect(t.handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'live.clock.recover')).all()).toHaveLength(1)
    expect(getLive(time.ctx(), m.matchId).events.find((e) => e.type === 'clock_adjust')?.text).toMatch(/last saved 12:00, continued at 12:30/)
  })

  it('corrects the clock with a reason recorded in the ledger', () => {
    const m = readyMatch(time.ctx())
    startPeriod(time.ctx(), m.matchId)
    expect(() => setClock(time.ctx(), { matchId: m.matchId, ms: 31 * MIN, reason: 'late start' })).toThrow(/within First half/)
    const live = setClock(time.ctx(), { matchId: m.matchId, ms: 5 * MIN, reason: 'Clock not started at throw-off' })
    expect(live.clock.elapsedMs).toBe(5 * MIN)
    expect(live.events[0]).toMatchObject({ type: 'clock_adjust', text: '00:00 -> 05:00: Clock not started at throw-off' })
  })
})

describe('corrections', () => {
  it('voids an event without erasing it', () => {
    const m = readyMatch(time.ctx())
    startPeriod(time.ctx(), m.matchId)
    const g = goal(m.matchId, 'home', m.home.get(5)!).events[0]
    const live = voidEvent(time.ctx(), { matchId: m.matchId, eventId: g.id, reason: 'Undo - goal disallowed' })
    expect(live.home.score).toBe(0)
    expect(live.events.find((e) => e.id === g.id)).toMatchObject({ status: 'voided', voidReason: 'Undo - goal disallowed', correctable: false })
    expect(() => voidEvent(time.ctx(), { matchId: m.matchId, eventId: g.id, reason: 'again' })).toThrow(/already been voided/)
  })

  it('replaces an event with a corrected copy validated at the original time', () => {
    const m = readyMatch(time.ctx())
    startPeriod(time.ctx(), m.matchId)
    clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })
    time.advance(5 * MIN)
    const g = goal(m.matchId, 'home', m.home.get(5)!).events[0]
    time.advance(10 * MIN)
    // A later disqualification of #6 must not block correcting an earlier goal to #6.
    insertEvent(time.ctx(), m.matchId, { type: 'disqualification', side: 'home', rosterId: m.home.get(6)!, periodSeq: 1, matchMs: 15 * MIN })
    const shot = { kind: 'shot' as const, side: 'home' as const, rosterId: m.home.get(6)!, outcome: 'goal' as const, situation: 'fast_break' as const, zone: null, assistRosterId: null }
    const live = editEvent(time.ctx(), { matchId: m.matchId, eventId: g.id, event: shot, matchMs: 4 * MIN, reason: 'Wrong scorer' })
    const fixed = live.events.find((e) => e.replacesEventId === g.id)!
    expect(fixed).toMatchObject({ matchMs: 4 * MIN, situation: 'fast_break', status: 'active' })
    expect(fixed.player?.jerseyNumber).toBe(6)
    expect(live.events.find((e) => e.id === g.id)?.status).toBe('voided')
    expect(live.home.score).toBe(1)
    const steal = { kind: 'steal' as const, side: 'home' as const, rosterId: null }
    expect(() => editEvent(time.ctx(), { matchId: m.matchId, eventId: fixed.id, event: steal, matchMs: 20 * MIN, reason: 'future' })).toThrow(/between 00:00 and 15:00/)
  })

  it('mirrors substitutions and voids the mirror with the event', () => {
    const m = readyMatch(time.ctx())
    startPeriod(time.ctx(), m.matchId)
    const event = { kind: 'substitution' as const, side: 'away' as const, outRosterId: m.away.get(1)!, inRosterId: m.away.get(12)! }
    let live = recordEvent(time.ctx(), { matchId: m.matchId, clientRequestId: rid(), event })
    expect(live.away.players.find((p) => p.jerseyNumber === 12)?.status).toBe('court')
    const sub = live.events.find((e) => e.type === 'substitution')!
    voidEvent(time.ctx(), { matchId: m.matchId, eventId: sub.id, reason: 'Recorded by mistake' })
    expect(t.handle.db.select().from(substitutions).get()?.status).toBe('voided')
  })

  it('refuses to void a substitution that later entries depend on', () => {
    const m = readyMatch(time.ctx())
    startPeriod(time.ctx(), m.matchId)
    const event = { kind: 'substitution' as const, side: 'away' as const, outRosterId: m.away.get(1)!, inRosterId: m.away.get(12)! }
    recordEvent(time.ctx(), { matchId: m.matchId, clientRequestId: rid(), event })
    const live = goal(m.matchId, 'home', m.home.get(3)!)
    expect(live.events[0].goalkeeper?.jerseyNumber).toBe(12)
    const sub = live.events.find((e) => e.type === 'substitution')!
    expect(() => voidEvent(time.ctx(), { matchId: m.matchId, eventId: sub.id, reason: 'mistake' })).toThrow(/Later entries involve/)
  })

  it('validates a correction against entries made earlier at the same match time only', () => {
    const m = readyMatch(time.ctx())
    startPeriod(time.ctx(), m.matchId) // clock stopped: every entry shares 00:00
    const g = goal(m.matchId, 'home', m.home.get(5)!).events[0]
    insertEvent(time.ctx(), m.matchId, { type: 'suspension', side: 'home', rosterId: m.home.get(5)!, periodSeq: 1, matchMs: 0 })
    const fixed = { kind: 'shot' as const, side: 'home' as const, rosterId: m.home.get(5)!, outcome: 'goal' as const, situation: 'positional' as const, zone: 'wing' as const, assistRosterId: null }
    const live = editEvent(time.ctx(), { matchId: m.matchId, eventId: g.id, event: fixed, reason: 'Zone added' })
    expect(live.events.find((e) => e.replacesEventId === g.id)?.zone).toBe('wing')
  })

  it('does not move an event past the real end of a period that ended early', () => {
    const m = readyMatch(time.ctx())
    startPeriod(time.ctx(), m.matchId)
    clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })
    time.advance(2 * MIN)
    const g = goal(m.matchId, 'home', m.home.get(5)!).events[0]
    time.advance(MIN)
    clockAction(time.ctx(), { matchId: m.matchId, action: 'stop' })
    endPeriod(time.ctx(), { matchId: m.matchId, force: true })
    const shot = { kind: 'shot' as const, side: 'home' as const, rosterId: m.home.get(5)!, outcome: 'goal' as const, situation: 'positional' as const, zone: null, assistRosterId: null }
    expect(() => editEvent(time.ctx(), { matchId: m.matchId, eventId: g.id, event: shot, matchMs: 10 * MIN, reason: 'time' })).toThrow(/between 00:00 and 03:00/)
  })

  it('lets only an administrator correct a finalized match and marks it amended', () => {
    const m = readyMatch(time.ctx())
    startPeriod(time.ctx(), m.matchId)
    const g = goal(m.matchId, 'home', m.home.get(5)!).events[0]
    playOut(m.matchId)
    startPeriod(time.ctx(), m.matchId)
    playOut(m.matchId)
    finishMatch(time.ctx(), { matchId: m.matchId, force: false })
    expect(getLive(time.ctx(OPERATOR), m.matchId).events.every((e) => !e.correctable)).toBe(true)
    expect(() => voidEvent(time.ctx(OPERATOR), { matchId: m.matchId, eventId: g.id, reason: 'disallowed' })).toThrow(/administrator/)
    voidEvent(time.ctx(), { matchId: m.matchId, eventId: g.id, reason: 'Video review: no goal' })
    const row = t.handle.db.select().from(matches).where(eq(matches.id, m.matchId)).get()!
    expect(row).toMatchObject({ homeScore: 0, awayScore: 0, winnerSide: 'draw', amended: true })
  })
})

describe('finishing', () => {
  it('asks before finishing level when a winner is required but no tie-break is configured', () => {
    const k = RULE_PRESETS.find((p) => p.presetId === 'ihf_senior_knockout')!
    const rules = { ...k, overtime: { ...k.overtime, enabled: false }, shootout: { ...k.shootout, enabled: false } }
    const m = readyMatch(time.ctx(), rules)
    startPeriod(time.ctx(), m.matchId)
    playOut(m.matchId)
    startPeriod(time.ctx(), m.matchId)
    expect(playOut(m.matchId).canFinish).toBe(true)
    expect(() => finishMatch(time.ctx(), { matchId: m.matchId, force: false })).toThrow(/require a winner/)
    finishMatch(time.ctx(), { matchId: m.matchId, force: true })
    expect(t.handle.db.select().from(matches).where(eq(matches.id, m.matchId)).get()?.winnerSide).toBe('draw')
  })
})

describe('knockout flow', () => {
  const knockout = RULE_PRESETS.find((p) => p.presetId === 'ihf_senior_knockout')!

  it('requires overtime when level and a winner is required', () => {
    const m = readyMatch(time.ctx(), knockout)
    startPeriod(time.ctx(), m.matchId)
    playOut(m.matchId)
    startPeriod(time.ctx(), m.matchId)
    const live = playOut(m.matchId)
    expect(live.canFinish).toBe(false)
    expect(live.nextPeriod?.shortLabel).toBe('OT1.1')
    expect(() => finishMatch(time.ctx(), { matchId: m.matchId, force: false })).toThrow(/after the final period/)
    expect(startPeriod(time.ctx(), m.matchId).clock).toMatchObject({ periodSeq: 3, elapsedMs: 60 * MIN })
  })

  it('decides a match by penalty shoot-out', () => {
    const rules = { ...knockout, overtime: { ...knockout.overtime, enabled: false }, shootout: { enabled: true, throwsPerTeam: 2 } }
    const m = readyMatch(time.ctx(), rules)
    startPeriod(time.ctx(), m.matchId)
    playOut(m.matchId)
    startPeriod(time.ctx(), m.matchId)
    playOut(m.matchId)
    let live = startPeriod(time.ctx(), m.matchId)
    expect(live.period?.kind).toBe('shootout')
    expect(() => clockAction(time.ctx(), { matchId: m.matchId, action: 'start' })).toThrow(/without the match clock/)
    const throwShot = (side: 'home' | 'away', jersey: number, outcome: 'goal' | 'saved') =>
      recordEvent(time.ctx(), {
        matchId: m.matchId,
        clientRequestId: rid(),
        event: { kind: 'shot', side, rosterId: (side === 'home' ? m.home : m.away).get(jersey)!, outcome, situation: 'shootout', zone: null, assistRosterId: null }
      })
    throwShot('home', 2, 'goal')
    expect(() => throwShot('home', 3, 'goal')).toThrow(/other team/)
    throwShot('away', 2, 'saved')
    throwShot('home', 3, 'goal')
    // Events are newest first, so the last shoot-out entry in the list is the first throw.
    const first = getLive(time.ctx(), m.matchId).events.filter((e) => e.situation === 'shootout').pop()!
    expect(() => voidEvent(time.ctx(), { matchId: m.matchId, eventId: first.id, reason: 'wrong' })).toThrow(/Only the last shoot-out throw/)
    live = getLive(time.ctx(), m.matchId)
    expect(live.shootout).toMatchObject({ decided: true, winner: 'home' })
    endPeriod(time.ctx(), { matchId: m.matchId, force: false })
    finishMatch(time.ctx(), { matchId: m.matchId, force: false })
    const row = t.handle.db.select().from(matches).where(eq(matches.id, m.matchId)).get()!
    expect(row).toMatchObject({ homeScore: 0, awayScore: 0, homeShootout: 2, awayShootout: 0, winnerSide: 'home', decidedBy: 'shootout' })
    expect(t.handle.db.select().from(matchEvents).all().filter((e) => e.type === 'period_start')).toHaveLength(3)
  })
})

describe('sleep during a match', () => {
  it('counts only the time up to the last good tick when the computer sleeps unannounced', () => {
    const { matchId } = readyMatch(time.ctx())
    startPeriod(time.ctx(), matchId)
    clockAction(time.ctx(), { matchId, action: 'start' })
    time.advance(60_000)
    const lastTick = time.ctx().mono!()
    time.advance(600_000)

    stopAllClocks({ ...time.ctx(), mono: () => lastTick }, 'The computer went to sleep')

    expect(getLive(time.ctx(), matchId).clock).toMatchObject({ running: false, elapsedMs: 60_000 })
  })
})

describe('demonstration mode', () => {
  it('cannot open while a match is in progress', () => {
    const { matchId } = readyMatch(time.ctx())
    expect(() => assertNoLiveMatch(time.ctx())).not.toThrow()
    startPeriod(time.ctx(), matchId)
    expect(() => assertNoLiveMatch(time.ctx())).toThrow(/match is in progress/)
  })
})
