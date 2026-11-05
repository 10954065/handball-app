import type { Side } from './constants'
import { activeEvents } from './ledger'
import type { LedgerEvent } from './types'

export interface PlayerTally {
  goals: number
  shots: number
  sevenMetreGoals: number
  sevenMetreShots: number
  assists: number
  saves: number
  shotsFaced: number
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
}

const emptyPlayer = (): PlayerTally => ({ goals: 0, shots: 0, sevenMetreGoals: 0, sevenMetreShots: 0, assists: 0, saves: 0, shotsFaced: 0 })
const emptyTeam = (): TeamTally => ({
  goals: 0,
  shots: 0,
  saves: 0,
  sevenMetreGoals: 0,
  sevenMetreShots: 0,
  technicalFaults: 0,
  turnovers: 0,
  steals: 0,
  blocks: 0
})

/**
 * Running counts for the live screen, derived from active ledger events only.
 * Shoot-out throws are excluded: they decide the winner but are not match statistics.
 */
export function liveTallies(events: readonly LedgerEvent[]): { players: Map<string, PlayerTally>; teams: Record<Side, TeamTally> } {
  const players = new Map<string, PlayerTally>()
  const teams: Record<Side, TeamTally> = { home: emptyTeam(), away: emptyTeam() }
  const p = (id: string) => {
    let t = players.get(id)
    if (!t) players.set(id, (t = emptyPlayer()))
    return t
  }
  for (const e of activeEvents(events)) {
    if (!e.side) continue
    const team = teams[e.side]
    const opp = teams[e.side === 'home' ? 'away' : 'home']
    if (e.type === 'shot' && e.situation !== 'shootout') {
      const goal = e.outcome === 'goal'
      const seven = e.situation === 'seven_metre'
      team.shots++
      if (goal) team.goals++
      if (seven) {
        team.sevenMetreShots++
        if (goal) team.sevenMetreGoals++
      }
      if (e.outcome === 'saved') opp.saves++
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
      if (e.goalkeeperRosterId) {
        const g = p(e.goalkeeperRosterId)
        g.shotsFaced++
        if (e.outcome === 'saved') g.saves++
      }
    }
    if (e.type === 'technical_fault') team.technicalFaults++
    if (e.type === 'turnover') team.turnovers++
    if (e.type === 'steal') team.steals++
    if (e.type === 'block') team.blocks++
  }
  return { players, teams }
}
