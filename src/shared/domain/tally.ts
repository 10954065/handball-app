import type { Side } from './constants'
import { activeEvents } from './ledger'
import type { LedgerEvent } from './types'

export interface PlayerTally {
  goals: number
  shots: number
  sevenMetreGoals: number
  sevenMetreShots: number
  assists: number
  steals: number
  blocks: number
  turnovers: number
  technicalFaults: number
  warnings: number
  suspensions: number
  disqualifications: number
  saves: number
  /** Shots on target against this goalkeeper: saves plus goals conceded. */
  shotsFaced: number
  goalsConceded: number
  sevenMetreSaves: number
  sevenMetreFaced: number
}

export interface TeamTally {
  goals: number
  shots: number
  saves: number
  sevenMetreGoals: number
  sevenMetreShots: number
  technicalFaults: number
  turnovers: number
  steals: number
  blocks: number
  /** Sanctions include those of team officials. */
  warnings: number
  suspensions: number
  disqualifications: number
  timeouts: number
  goalsConceded: number
  sevenMetreSaves: number
  sevenMetreFaced: number
}

export const emptyPlayerTally = (): PlayerTally => ({
  goals: 0,
  shots: 0,
  sevenMetreGoals: 0,
  sevenMetreShots: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  technicalFaults: 0,
  warnings: 0,
  suspensions: 0,
  disqualifications: 0,
  saves: 0,
  shotsFaced: 0,
  goalsConceded: 0,
  sevenMetreSaves: 0,
  sevenMetreFaced: 0
})

const emptyTeam = (): TeamTally => ({
  goals: 0,
  shots: 0,
  saves: 0,
  sevenMetreGoals: 0,
  sevenMetreShots: 0,
  technicalFaults: 0,
  turnovers: 0,
  steals: 0,
  blocks: 0,
  warnings: 0,
  suspensions: 0,
  disqualifications: 0,
  timeouts: 0,
  goalsConceded: 0,
  sevenMetreSaves: 0,
  sevenMetreFaced: 0
})

const PLAY_FIELDS = { technical_fault: 'technicalFaults', turnover: 'turnovers', steal: 'steals', block: 'blocks' } as const
const SANCTION_FIELDS = { warning: 'warnings', suspension: 'suspensions', disqualification: 'disqualifications' } as const

export interface Tallies {
  players: Map<string, PlayerTally>
  teams: Record<Side, TeamTally>
}

/**
 * Every statistic of a match, derived from active ledger events only. The live screen, the match
 * report, the statistics pages and the player profile all read these numbers.
 * Shoot-out throws are excluded: they decide the winner but are not match statistics.
 */
export function liveTallies(events: readonly LedgerEvent[]): Tallies {
  const players = new Map<string, PlayerTally>()
  const teams: Record<Side, TeamTally> = { home: emptyTeam(), away: emptyTeam() }
  const p = (id: string) => {
    let t = players.get(id)
    if (!t) players.set(id, (t = emptyPlayerTally()))
    return t
  }
  for (const e of activeEvents(events)) {
    if (!e.side) continue
    const team = teams[e.side]
    const opp = teams[e.side === 'home' ? 'away' : 'home']
    if (e.type === 'shot' && e.situation !== 'shootout') {
      const goal = e.outcome === 'goal'
      const saved = e.outcome === 'saved'
      const seven = e.situation === 'seven_metre'
      team.shots++
      if (goal) {
        team.goals++
        opp.goalsConceded++
      }
      if (seven) {
        team.sevenMetreShots++
        if (goal) team.sevenMetreGoals++
      }
      if (saved) opp.saves++
      if (seven && (goal || saved)) opp.sevenMetreFaced++
      if (seven && saved) opp.sevenMetreSaves++
      if (e.rosterId) {
        const s = p(e.rosterId)
        s.shots++
        if (goal) s.goals++
        if (seven) {
          s.sevenMetreShots++
          if (goal) s.sevenMetreGoals++
        }
      }
      if (goal && e.assistRosterId) p(e.assistRosterId).assists++
      if (e.goalkeeperRosterId && (goal || saved)) {
        const g = p(e.goalkeeperRosterId)
        g.shotsFaced++
        if (saved) g.saves++
        if (goal) g.goalsConceded++
        if (seven) {
          g.sevenMetreFaced++
          if (saved) g.sevenMetreSaves++
        }
      }
    }
    if (e.type === 'timeout') team.timeouts++
    if (e.type === 'technical_fault' || e.type === 'turnover' || e.type === 'steal' || e.type === 'block') {
      const field = PLAY_FIELDS[e.type]
      team[field]++
      if (e.rosterId) p(e.rosterId)[field]++
    }
    if (e.type === 'warning' || e.type === 'suspension' || e.type === 'disqualification') {
      const field = SANCTION_FIELDS[e.type]
      team[field]++
      if (e.rosterId) p(e.rosterId)[field]++
    }
  }
  return { players, teams }
}
