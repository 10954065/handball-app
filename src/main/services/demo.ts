import { count } from 'drizzle-orm'
import type { Position } from '@shared/domain/constants'
import { RULE_PRESETS } from '@shared/domain/rules'
import { teams } from '../db/schema'
import { createCompetition, createSeason, setSeasonTeams, updateSeason } from './competitions'
import type { Ctx } from './ctx'
import { createOfficial, createVenue } from './directory'
import { createMatch } from './matches'
import { createPlayer } from './players'
import { getSettings, updateSettings } from './settings'
import { createTeam, updateTeam } from './teams'

/*
 * Demonstration data. Every name below is fictional and every team is labelled "Sample".
 * This runs only in demo mode, against the separate demo database, and only once.
 */
const TEAMS = [
  { name: 'Sample Accra Lions HC', shortName: 'Accra Lions', code: 'ACL', region: 'Greater Accra', primaryColor: '#d4202f', secondaryColor: '#ffffff', coach: 'Kofi Asante' },
  { name: 'Sample Kumasi Royals HC', shortName: 'Kumasi Royals', code: 'KUR', region: 'Ashanti', primaryColor: '#f5b301', secondaryColor: '#101010', coach: 'Yaw Boateng' },
  { name: 'Sample Tema Harbour HC', shortName: 'Tema Harbour', code: 'TEH', region: 'Greater Accra', primaryColor: '#1d4ed8', secondaryColor: '#ffffff', coach: 'Ama Owusu' },
  { name: 'Sample Cape Coast Mariners', shortName: 'CC Mariners', code: 'CCM', region: 'Central', primaryColor: '#059669', secondaryColor: '#fde047', coach: 'Esi Quaye' }
]

const FIRST = ['Kwame', 'Kofi', 'Yaw', 'Kwabena', 'Kojo', 'Kwaku', 'Kwesi', 'Nana', 'Fiifi', 'Ebo', 'Selorm', 'Elikem', 'Senyo', 'Mawuli', 'Delali', 'Edem']
const LAST = ['Mensah', 'Owusu', 'Boateng', 'Asante', 'Osei', 'Agyeman', 'Appiah', 'Darko', 'Ansah', 'Tetteh', 'Quaye', 'Adjei', 'Ofori', 'Amoah', 'Badu', 'Nkrumah']
const LINEUP: Position[] = ['goalkeeper', 'left_wing', 'left_back', 'centre_back', 'right_back', 'right_wing', 'pivot']
const BENCH: Position[] = ['goalkeeper', 'left_back', 'centre_back', 'right_wing', 'pivot', 'left_wing', 'right_back']
const JERSEYS = [1, 5, 9, 10, 14, 23, 33, 12, 4, 7, 18, 21, 25, 30]

export function seedDemoData(ctx: Ctx): void {
  if (ctx.mode !== 'demo') return
  if (!getSettings(ctx).organisationName) updateSettings(ctx, { organisationName: 'HMMS Demonstration (sample data)' })
  if ((ctx.db.select({ n: count() }).from(teams).get()?.n ?? 0) > 0) return

  const venue = createVenue(ctx, { name: 'Sample Sports Hall', city: 'Accra', capacity: 2000 })
  createVenue(ctx, { name: 'Sample Indoor Arena', city: 'Kumasi', capacity: 1500 })
  const refs = [
    createOfficial(ctx, { fullName: 'Sample Referee A. Darko', role: 'referee', licenseNo: 'REF-001', region: 'Greater Accra' }),
    createOfficial(ctx, { fullName: 'Sample Referee B. Ofori', role: 'referee', licenseNo: 'REF-002', region: 'Ashanti' }),
    createOfficial(ctx, { fullName: 'Sample Delegate C. Amoah', role: 'delegate', licenseNo: 'DEL-001' }),
    createOfficial(ctx, { fullName: 'Sample Timekeeper D. Badu', role: 'timekeeper' })
  ]

  const teamIds: string[] = []
  TEAMS.forEach((t, ti) => {
    const team = createTeam(ctx, { ...t, country: 'Ghana', clubName: t.name, homeVenue: venue.name })
    teamIds.push(team.id)
    let captain: string | null = null
    let gk: string | null = null
    JERSEYS.forEach((jersey, i) => {
      const position = i < 7 ? LINEUP[i] : BENCH[i - 7]
      const p = createPlayer(ctx, {
        firstName: FIRST[(i + ti * 3) % FIRST.length],
        lastName: LAST[(i * 5 + ti) % LAST.length],
        dateOfBirth: `${1994 + ((i + ti) % 10)}-0${1 + (i % 9)}-1${i % 9}`,
        gender: 'male',
        nationality: 'Ghana',
        position,
        heightCm: 175 + ((i * 7 + ti) % 22),
        isGoalkeeper: position === 'goalkeeper',
        registrationStatus: 'registered',
        teamId: team.id,
        jerseyNumber: jersey
      })
      if (i === 3) captain = p.id
      if (i === 0) gk = p.id
    })
    updateTeam(ctx, { ...t, id: team.id, country: 'Ghana', clubName: t.name, homeVenue: venue.name, captainPlayerId: captain, primaryGoalkeeperId: gk })
  })

  const comp = createCompetition(ctx, {
    name: 'Sample National Handball League',
    shortName: 'Sample League',
    type: 'league',
    category: 'Senior Men',
    organizer: 'HMMS Demonstration',
    rules: RULE_PRESETS[0],
    pointsWin: 2,
    pointsDraw: 1,
    pointsLoss: 0,
    tiebreakers: ['points', 'head_to_head_points', 'head_to_head_goal_difference', 'goal_difference', 'goals_for']
  })
  const season = createSeason(ctx, { competitionId: comp.id, name: '2026/27', startDate: '2026-10-01', endDate: '2027-05-31', status: 'planned' })
  setSeasonTeams(ctx, { seasonId: season.id, teams: teamIds.map((teamId) => ({ teamId, groupName: null })) })
  updateSeason(ctx, { id: season.id, name: season.name, startDate: season.startDate, endDate: season.endDate, status: 'active' })

  const day = 24 * 3600_000
  const start = Date.now() + day
  const pairs: [number, number][] = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]]
  pairs.forEach(([h, a], i) =>
    createMatch(ctx, {
      homeTeamId: teamIds[h],
      awayTeamId: teamIds[a],
      competitionId: comp.id,
      seasonId: season.id,
      venueId: venue.id,
      scheduledAt: start + Math.floor(i / 2) * 7 * day + (i % 2) * 2 * 3600_000,
      stage: 'league',
      round: Math.floor(i / 2) + 1,
      officials: [
        { officialId: refs[0].id, role: 'Referee' },
        { officialId: refs[1].id, role: 'Referee' },
        { officialId: refs[2].id, role: 'Delegate' },
        { officialId: refs[3].id, role: 'Timekeeper' }
      ]
    })
  )
}
