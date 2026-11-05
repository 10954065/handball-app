import type { LedgerEvent, RosterEntry, TeamOfficialEntry } from '@shared/domain/types'
import type { Side } from '@shared/domain/constants'

export function rosterEntry(side: Side, jersey: number, extra: Partial<RosterEntry> = {}): RosterEntry {
  return {
    id: `${side}-${jersey}`,
    side,
    teamId: `team-${side}`,
    playerId: `player-${side}-${jersey}`,
    jersey,
    name: `Player ${side} ${jersey}`,
    position: null,
    isGoalkeeper: jersey === 1,
    isCaptain: jersey === 7,
    isStarting: jersey <= 7,
    isStartingGk: jersey === 1,
    photoMediaId: null,
    ...extra
  }
}

export function fullRoster(): RosterEntry[] {
  const r: RosterEntry[] = []
  for (const side of ['home', 'away'] as const) for (let j = 1; j <= 14; j++) r.push(rosterEntry(side, j))
  return r
}

export const officialsFixture: TeamOfficialEntry[] = [
  { id: 'home-A', side: 'home', slot: 'A', name: 'Coach Home', role: 'Head coach' },
  { id: 'home-B', side: 'home', slot: 'B', name: 'Assistant Home', role: 'Assistant' },
  { id: 'away-A', side: 'away', slot: 'A', name: 'Coach Away', role: 'Head coach' }
]

let seq = 0
export function ev(type: LedgerEvent['type'], extra: Partial<LedgerEvent> = {}): LedgerEvent {
  seq++
  return {
    id: `e${seq}`,
    seq,
    type,
    side: 'home',
    rosterId: null,
    teamOfficialId: null,
    periodSeq: 1,
    matchMs: 0,
    outcome: null,
    situation: null,
    zone: null,
    assistRosterId: null,
    goalkeeperRosterId: null,
    inRosterId: null,
    blueCard: false,
    teamReduction: false,
    causedByEventId: null,
    reason: null,
    status: 'active',
    ...extra
  }
}

export const goal = (side: Side, jersey: number, matchMs: number, extra: Partial<LedgerEvent> = {}) =>
  ev('shot', { side, rosterId: `${side}-${jersey}`, outcome: 'goal', situation: 'positional', matchMs, ...extra })
