import type { RulesConfig } from '../../src/shared/domain/rules'
import { confirmLineup, getMatchSetup, saveLineup } from '../../src/main/services/lineups'
import { createMatch } from '../../src/main/services/matches'
import { createPlayer } from '../../src/main/services/players'
import { createTeam } from '../../src/main/services/teams'
import type { Ctx } from '../../src/main/services/ctx'
import type { TestDb } from './helpers'

/** A controllable clock: monotonic and wall time advance together; bootId simulates a restart. */
export function fakeTime(t: TestDb) {
  const s = { mono: 5_000, wall: 1_800_000_000_000, boot: 'boot-1' }
  const ctx = (user?: Parameters<TestDb['ctx']>[0]): Ctx => ({ ...t.ctx(user), mono: () => s.mono, now: () => s.wall, bootId: s.boot })
  return {
    ctx,
    advance: (ms: number) => {
      s.mono += ms
      s.wall += ms
    },
    /** Simulate the application closing unexpectedly and starting again after wallGapMs. */
    restart: (wallGapMs: number) => {
      s.boot = `boot-${Math.random()}`
      s.mono = 1_000
      s.wall += wallGapMs
    }
  }
}

function team(ctx: Ctx, code: string) {
  const tm = createTeam(ctx, { name: `Team ${code}`, shortName: code, code, primaryColor: code === 'HOM' ? '#c00000' : '#0000c0', secondaryColor: '#ffffff' })
  for (let i = 1; i <= 14; i++) {
    createPlayer(ctx, {
      firstName: `P${i}`,
      lastName: code,
      isGoalkeeper: i === 1 || i === 12,
      position: i === 1 || i === 12 ? 'goalkeeper' : 'centre_back',
      registrationStatus: 'registered',
      teamId: tm.id,
      jerseyNumber: i
    })
  }
  return tm
}

function confirmLineups(ctx: Ctx, matchId: string) {
  for (const side of ['home', 'away'] as const) {
    const squad = getMatchSetup(ctx, matchId)[side].squad
    saveLineup(ctx, {
      matchId,
      side,
      entries: squad.map((p) => ({ playerId: p.playerId, jerseyNumber: p.jerseyNumber, isStarting: p.jerseyNumber <= 7, isStartingGk: p.jerseyNumber === 1, isCaptain: p.jerseyNumber === 4 })),
      officials: [{ slot: 'A', name: `Coach ${side}`, role: 'Head coach' }]
    })
    confirmLineup(ctx, { matchId, side })
  }
  const setup = getMatchSetup(ctx, matchId)
  const ids = (side: 'home' | 'away') => new Map(setup[side].entries.map((e) => [e.jerseyNumber, e.rosterId]))
  return { matchId, home: ids('home'), away: ids('away') }
}

/** A match with both lineups confirmed (#1-#7 start, #1 in goal). Returns roster ids by side and jersey. */
export function readyMatch(ctx: Ctx, rules?: RulesConfig) {
  const h = team(ctx, 'HOM')
  const a = team(ctx, 'AWY')
  const match = createMatch(ctx, { homeTeamId: h.id, awayTeamId: a.id, scheduledAt: Date.now(), stage: 'friendly', officials: [], rules })
  return { ...confirmLineups(ctx, match.id), homeTeamId: h.id, awayTeamId: a.id }
}

/** A further match between two existing teams. */
export function rematch(ctx: Ctx, homeTeamId: string, awayTeamId: string, rules?: RulesConfig) {
  const match = createMatch(ctx, { homeTeamId, awayTeamId, scheduledAt: Date.now() + 1000, stage: 'friendly', officials: [], rules })
  return { ...confirmLineups(ctx, match.id), homeTeamId, awayTeamId }
}
