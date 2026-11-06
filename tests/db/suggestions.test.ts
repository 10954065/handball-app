import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LiveMatchDTO, SessionUser } from '../../src/shared/dto'
import { ROLE_PERMISSIONS } from '../../src/shared/domain/constants'
import { aiEventSuggestions, auditLogs, matchEvents } from '../../src/main/db/schema'
import { clockAction, endPeriod, finishMatch, getLive, recordEvent, recordSanction, startPeriod, tickClocks, voidEvent } from '../../src/main/services/live'
import { confirmSuggestion, expireSuggestions, listSuggestions, proposeSuggestion, rejectSuggestion } from '../../src/main/services/suggestions'
import { testDb, type TestDb } from './helpers'
import { fakeTime, readyMatch } from './live-fixture'

let t: TestDb
let time: ReturnType<typeof fakeTime>
let matchId: string
const SECOND = 1000
const VIEWER: SessionUser = { id: '00000000-0000-4000-8000-000000000003', username: 'v', displayName: 'V', role: 'viewer', permissions: [...ROLE_PERMISSIONS.viewer] }

beforeEach(() => {
  t = testDb(true)
  time = fakeTime(t)
  matchId = readyMatch(time.ctx()).matchId
  startPeriod(time.ctx(), matchId)
  clockAction(time.ctx(), { matchId, action: 'start' })
  time.advance(60 * SECOND)
})
afterEach(() => t.cleanup())

const live = (): LiveMatchDTO => getLive(time.ctx(), matchId)
const shooter = (side: 'home' | 'away' = 'home') => live()[side].players.find((p) => p.status === 'court' && !p.isGoalkeeper)!
const propose = (over: Record<string, unknown> = {}) => proposeSuggestion(time.ctx(), { matchId, category: 'goal', side: 'home', jersey: null, trackId: 7, confidence: 0.8, cameraId: null, ageMs: 0, evidence: { frame: 12 }, ...over })
const goals = () => t.handle.db.select().from(matchEvents).where(eq(matchEvents.type, 'shot')).all().filter((e) => e.status === 'active')
const audits = (action: string) => t.handle.db.select().from(auditLogs).where(eq(auditLogs.action, action)).all()

describe('a suggestion before anyone confirms it', () => {
  it('is stored apart from the match record, and changes nothing official', () => {
    const before = live()
    const s = propose()!
    expect(s).toMatchObject({ status: 'pending', category: 'goal', side: 'home', eventId: null })
    expect(goals()).toEqual([])
    expect(live().home.score).toBe(before.home.score)
    expect(live().events).toHaveLength(before.events.length)
  })

  it('does not reach statistics', () => {
    propose()
    expect(live().home.players.reduce((sum, p) => sum + p.goals + p.shots, 0)).toBe(0)
  })

  it('takes its time from the match clock, allowing for the delay in analysis', () => {
    expect(propose({ ageMs: 2000 })!.matchMs).toBe(58 * SECOND)
  })

  it('cannot start before the period did', () => {
    expect(propose({ ageMs: 999_999 })!.matchMs).toBe(0)
  })

  it('never invents a player: with no number, the player stays unknown', () => {
    expect(propose()!.rosterId).toBeNull()
  })

  it('matches a recognised jersey number to the roster', () => {
    const p = shooter()
    expect(propose({ jersey: p.jerseyNumber })!.rosterId).toBe(p.rosterId)
  })

  it('leaves the player unknown when the number is not on the roster', () => {
    expect(propose({ jersey: 98 })!.rosterId).toBeNull()
  })

  it('looks only at the suggested team when matching a number', () => {
    const away = shooter('away')
    const homeHasIt = live().home.players.some((p) => p.jerseyNumber === away.jerseyNumber)
    const s = propose({ side: 'home', jersey: away.jerseyNumber })!
    expect(s.rosterId === away.rosterId).toBe(false)
    if (!homeHasIt) expect(s.rosterId).toBeNull()
  })

  it('leaves the player unknown without a team to look in', () => {
    expect(propose({ side: null, jersey: shooter().jerseyNumber })!.rosterId).toBeNull()
  })
})

describe('when a suggestion is not worth making', () => {
  it('ignores a match that is not in progress', () => {
    const other = readyMatch(time.ctx())
    expect(proposeSuggestion(time.ctx(), { matchId: other.matchId, category: 'goal', side: 'home', jersey: null, trackId: null, confidence: 0.9, cameraId: null, ageMs: 0, evidence: null })).toBeNull()
  })

  it('ignores anything outside play, such as a break', () => {
    clockAction(time.ctx(), { matchId, action: 'stop' })
    time.advance(31 * 60 * SECOND)
    clockAction(time.ctx(), { matchId, action: 'start' })
    time.advance(31 * 60 * SECOND)
    tickClocks(time.ctx())
    endPeriod(time.ctx(), { matchId, force: true })
    expect(propose()).toBeNull()
  })

  it('merges repeat detections of one action into a single suggestion', () => {
    const first = propose({ confidence: 0.6 })!
    time.advance(2 * SECOND)
    expect(propose({ confidence: 0.9, evidence: { frame: 40 } })).toBeNull()
    const list = listSuggestions(time.ctx(), matchId)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: first.id, confidence: 0.9 })
  })

  it('keeps the better detection when a weaker one follows', () => {
    propose({ confidence: 0.9 })
    time.advance(SECOND)
    propose({ confidence: 0.4 })
    expect(listSuggestions(time.ctx(), matchId)[0].confidence).toBe(0.9)
  })

  it('treats a later action as a new one', () => {
    propose()
    time.advance(20 * SECOND)
    expect(propose()).not.toBeNull()
  })

  it('treats the other team as a different action', () => {
    propose({ side: 'home' })
    expect(propose({ side: 'away' })).not.toBeNull()
  })

  it('does not suggest a goal an official has just recorded by hand', () => {
    const p = shooter()
    recordEvent(time.ctx(), { matchId, clientRequestId: crypto.randomUUID(), event: { kind: 'shot', side: 'home', rosterId: p.rosterId, outcome: 'goal', situation: 'positional', zone: null, assistRosterId: null } })
    time.advance(2 * SECOND)
    expect(propose()).toBeNull()
  })

  it('does not bring back a suggestion that was just rejected', () => {
    rejectSuggestion(time.ctx(), { id: propose()!.id, reason: null })
    time.advance(2 * SECOND)
    expect(propose()).toBeNull()
  })
})

describe('confirming a suggestion', () => {
  it('records the goal through the match engine, at the time of the action', () => {
    const s = propose({ ageMs: 3000 })!
    const p = shooter()
    time.advance(20 * SECOND)
    const after = confirmSuggestion(time.ctx(), { id: s.id, side: 'home', rosterId: p.rosterId })
    expect(after.home.score).toBe(1)
    expect(after.home.players.find((x) => x.rosterId === p.rosterId)?.goals).toBe(1)
    const [event] = goals()
    expect(event).toMatchObject({ outcome: 'goal', matchMs: 57 * SECOND, rosterId: p.rosterId, clientRequestId: s.id })
    expect(listSuggestions(time.ctx(), matchId)[0]).toMatchObject({ status: 'confirmed', eventId: event.id })
  })

  it('updates official statistics by the normal route', () => {
    const s = propose()!
    confirmSuggestion(time.ctx(), { id: s.id, side: 'home', rosterId: shooter().rosterId })
    expect(live().events.find((e) => e.type === 'shot')).toMatchObject({ outcome: 'goal', side: 'home' })
  })

  it('cannot create two goals, however many times it is confirmed', () => {
    const s = propose()!
    const input = { id: s.id, side: 'home' as const, rosterId: shooter().rosterId }
    confirmSuggestion(time.ctx(), input)
    expect(confirmSuggestion(time.ctx(), input).home.score).toBe(1)
    expect(goals()).toHaveLength(1)
  })

  it('needs a player: an official goal always has a scorer', () => {
    const s = propose()!
    expect(() => confirmSuggestion(time.ctx(), { id: s.id, side: 'home', rosterId: null })).toThrow(/Choose the player/)
    expect(listSuggestions(time.ctx(), matchId)[0].status).toBe('pending')
  })

  it('needs a team', () => {
    const s = propose({ side: null })!
    expect(() => confirmSuggestion(time.ctx(), { id: s.id, side: null, rosterId: shooter().rosterId })).toThrow(/Choose the team/)
  })

  it('takes the player the suggestion named when none is chosen', () => {
    const p = shooter()
    const s = propose({ jersey: p.jerseyNumber })!
    expect(confirmSuggestion(time.ctx(), { id: s.id }).home.score).toBe(1)
  })

  it('records a save as a shot saved by the other team', () => {
    const s = propose({ category: 'save', side: 'home' })!
    const after = confirmSuggestion(time.ctx(), { id: s.id, side: 'home', rosterId: shooter().rosterId })
    expect(after.home.score).toBe(0)
    expect(goals()[0].outcome).toBe('saved')
  })

  it('needs an outcome for a shot', () => {
    const s = propose({ category: 'shot' })!
    expect(() => confirmSuggestion(time.ctx(), { id: s.id, side: 'home', rosterId: shooter().rosterId })).toThrow(/how the shot ended/)
    confirmSuggestion(time.ctx(), { id: s.id, side: 'home', rosterId: shooter().rosterId, outcome: 'missed' })
    expect(goals()[0].outcome).toBe('missed')
  })

  it('applies the rules of the game: a suspended player cannot score', () => {
    const p = shooter()
    recordSanction(time.ctx(), { matchId, clientRequestId: crypto.randomUUID(), kind: 'suspension', side: 'home', target: { type: 'player', rosterId: p.rosterId }, blueCard: false, acknowledged: false })
    time.advance(5 * SECOND)
    const s = propose()!
    expect(() => confirmSuggestion(time.ctx(), { id: s.id, side: 'home', rosterId: p.rosterId })).toThrow(/serving a suspension/)
    expect(goals()).toEqual([])
    expect(listSuggestions(time.ctx(), matchId)[0].status).toBe('pending')
  })

  it('judges a player as they stood at the moment of the action', () => {
    const p = shooter()
    const s = propose()!
    time.advance(10 * SECOND)
    recordSanction(time.ctx(), { matchId, clientRequestId: crypto.randomUUID(), kind: 'suspension', side: 'home', target: { type: 'player', rosterId: p.rosterId }, blueCard: false, acknowledged: false })
    expect(confirmSuggestion(time.ctx(), { id: s.id, side: 'home', rosterId: p.rosterId }).home.score).toBe(1)
  })

  it('refuses a time outside the period', () => {
    const s = propose()!
    expect(() => confirmSuggestion(time.ctx(), { id: s.id, side: 'home', rosterId: shooter().rosterId, matchMs: 99 * 60 * SECOND })).toThrow(/time must be between/)
  })

  it('can be undone with the existing tools, and the suggestion keeps its history', () => {
    const s = propose()!
    confirmSuggestion(time.ctx(), { id: s.id, side: 'home', rosterId: shooter().rosterId })
    voidEvent(time.ctx(), { matchId, eventId: goals()[0].id, reason: 'Wrong goal' })
    expect(live().home.score).toBe(0)
    expect(listSuggestions(time.ctx(), matchId)[0]).toMatchObject({ status: 'confirmed', eventVoided: true })
  })

  it('cannot be confirmed once the match has finished', () => {
    const s = propose()!
    const row = t.handle.db.select().from(aiEventSuggestions).get()!
    expect(row.id).toBe(s.id)
    expireSuggestions(time.ctx(), matchId)
    expect(() => confirmSuggestion(time.ctx(), { id: s.id, side: 'home', rosterId: shooter().rosterId })).toThrow(/already been decided/)
  })

  it('needs a signed-in user', () => {
    const s = propose()!
    expect(() => confirmSuggestion(time.ctx(null), { id: s.id, side: 'home', rosterId: shooter().rosterId })).toThrow()
  })
})

describe('correcting a suggestion', () => {
  it('records what the official chose, and keeps what the AI said', () => {
    const wrong = shooter('home')
    const right = shooter('away')
    const s = propose({ side: 'home', jersey: wrong.jerseyNumber })!
    const after = confirmSuggestion(time.ctx(), { id: s.id, side: 'away', rosterId: right.rosterId })
    expect(after.away.score).toBe(1)
    expect(after.home.score).toBe(0)
    const [saved] = listSuggestions(time.ctx(), matchId)
    expect(saved).toMatchObject({ status: 'corrected', side: 'home', rosterId: wrong.rosterId })
    expect(saved.correction).toMatchObject({ side: 'away', rosterId: right.rosterId })
  })

  it('counts a filled-in unknown player as confirmed, because nothing the AI said was wrong', () => {
    const s = propose()!
    confirmSuggestion(time.ctx(), { id: s.id, side: 'home', rosterId: shooter().rosterId })
    expect(listSuggestions(time.ctx(), matchId)[0].status).toBe('confirmed')
  })

  it('counts a changed time as a correction', () => {
    const p = shooter()
    const s = propose({ jersey: p.jerseyNumber })!
    confirmSuggestion(time.ctx(), { id: s.id, matchMs: 30 * SECOND })
    expect(listSuggestions(time.ctx(), matchId)[0].status).toBe('corrected')
    expect(goals()[0].matchMs).toBe(30 * SECOND)
  })
})

describe('rejecting a suggestion', () => {
  it('creates no event, and keeps the suggestion and the decision', () => {
    const s = propose()!
    rejectSuggestion(time.ctx(), { id: s.id, reason: 'Ball hit the post' })
    expect(goals()).toEqual([])
    expect(listSuggestions(time.ctx(), matchId)[0]).toMatchObject({ status: 'rejected', reason: 'Ball hit the post', decidedBy: expect.any(String) })
  })

  it('cannot be confirmed afterwards', () => {
    const s = propose()!
    rejectSuggestion(time.ctx(), { id: s.id, reason: null })
    expect(() => confirmSuggestion(time.ctx(), { id: s.id, side: 'home', rosterId: shooter().rosterId })).toThrow(/already been decided/)
  })

  it('cannot reject a confirmed goal, which is undone by voiding it', () => {
    const s = propose()!
    confirmSuggestion(time.ctx(), { id: s.id, side: 'home', rosterId: shooter().rosterId })
    expect(() => rejectSuggestion(time.ctx(), { id: s.id, reason: null })).toThrow(/already been decided/)
  })
})

describe('the audit trail', () => {
  it('records each decision with the user', () => {
    const a = propose()!
    confirmSuggestion(time.ctx(), { id: a.id, side: 'home', rosterId: shooter().rosterId })
    time.advance(30 * SECOND)
    rejectSuggestion(time.ctx(), { id: propose()!.id, reason: 'No' })
    expect(audits('ai.suggestion.confirm')).toHaveLength(1)
    expect(audits('ai.suggestion.reject')).toHaveLength(1)
    expect(audits('ai.suggestion.confirm')[0].username).toBeTruthy()
  })
})

describe('when the match ends', () => {
  it('expires what nobody decided, and leaves decisions alone', () => {
    const confirmed = propose()!
    confirmSuggestion(time.ctx(), { id: confirmed.id, side: 'home', rosterId: shooter().rosterId })
    time.advance(30 * SECOND)
    propose()
    expect(expireSuggestions(time.ctx(), matchId)).toBe(1)
    expect(listSuggestions(time.ctx(), matchId).map((s) => s.status).sort()).toEqual(['confirmed', 'expired'])
  })
})

describe('reading suggestions', () => {
  it('lists the newest first, and pending ones alone when asked', () => {
    const a = propose()!
    time.advance(30 * SECOND)
    const b = propose()!
    rejectSuggestion(time.ctx(), { id: a.id, reason: null })
    expect(listSuggestions(time.ctx(), matchId).map((s) => s.id)).toEqual([b.id, a.id])
    expect(listSuggestions(time.ctx(), matchId, 'pending').map((s) => s.id)).toEqual([b.id])
  })

  it('a viewer account is stopped at the channel, not here', () => {
    expect(time.ctx(VIEWER).user?.role).toBe('viewer')
  })
})

describe('finishing a match with suggestions waiting', () => {
  it('leaves the official result exactly as recorded', () => {
    propose()
    clockAction(time.ctx(), { matchId, action: 'stop' })
    expect(() => finishMatch(time.ctx(), { matchId, force: true })).toThrow()
    expect(live().home.score).toBe(0)
  })
})
