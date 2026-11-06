import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMatch } from '../../src/main/services/matches'
import { teamSheet } from '../../src/main/services/vision-sheet'
import { personLabel, sheetNumbers, shirtLabels, type TeamSheetDTO } from '../../src/shared/vision'
import { confirmLineups, fakeTime, team } from './live-fixture'
import { testDb, type TestDb } from './helpers'

let t: TestDb
beforeEach(() => {
  t = testDb(true)
})
afterEach(() => t.cleanup())

function match() {
  const ctx = fakeTime(t).ctx()
  const home = team(ctx, 'HOM')
  const away = team(ctx, 'AWY')
  const { id } = createMatch(ctx, { homeTeamId: home.id, awayTeamId: away.id, scheduledAt: 1_800_000_000_000, stage: 'friendly', officials: [] })
  return { ctx, id }
}

describe('the team sheet a camera works from', () => {
  it('holds the players on the match sheet, with the home side as Team A', () => {
    const { ctx, id } = match()
    confirmLineups(ctx, id)
    const sheet = teamSheet(ctx, id)
    expect(sheet.a.name).toBe('Team HOM')
    expect(sheet.b.name).toBe('Team AWY')
    expect(sheet.a.players).toHaveLength(14)
    expect(sheet.a.players[0]).toEqual({ number: 1, name: 'P1 HOM' })
  })

  it('refuses a match with nobody on its sheet, and says what to do', () => {
    const { ctx, id } = match()
    expect(() => teamSheet(ctx, id)).toThrow(/Enter them under Match sheet/)
  })

  it('reports a match that does not exist', () => {
    const { ctx } = match()
    expect(() => teamSheet(ctx, '00000000-0000-4000-8000-000000000000')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
  })

  it('tells the AI service numbers and never a name', () => {
    const { ctx, id } = match()
    confirmLineups(ctx, id)
    const sent = JSON.stringify(sheetNumbers(teamSheet(ctx, id)))
    expect(sent).not.toMatch(/HOM|AWY|P1/)
    expect(sheetNumbers(teamSheet(ctx, id)).a).toContain(13)
  })
})

describe('what someone is called on the picture', () => {
  const sheet: TeamSheetDTO = {
    matchId: 'm',
    a: { name: 'Accra Lions', players: [{ number: 13, name: 'Ama Mensah' }] },
    b: { name: 'Kumasi Stars', players: [] }
  }

  it('uses the player when their number is on the sheet', () => {
    expect(personLabel({ role: 'a', number: 13 }, sheet)).toBe('13 Ama Mensah')
  })

  it('uses the team until a number is agreed', () => {
    expect(personLabel({ role: 'b', number: null }, sheet)).toBe('Kumasi Stars')
    expect(personLabel({ role: 'a', number: null }, null)).toBe('Team A')
  })

  it('never names someone from the other team who has the same number', () => {
    expect(personLabel({ role: 'b', number: 13 }, sheet)).toBe('Kumasi Stars 13')
  })

  it('keeps officials and unmatched people unnamed', () => {
    expect(personLabel({ role: 'official', number: null }, sheet)).toBe('Official')
    expect(personLabel({ role: null, number: null }, sheet)).toBe('Player')
  })

  it('puts team names on the shirt buttons', () => {
    expect(shirtLabels(sheet).keeperB).toBe('Kumasi Stars goalkeeper')
    expect(shirtLabels(null).a).toBe('Team A')
  })
})
