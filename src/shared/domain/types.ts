import type { EventStatus, EventType, Position, ShotOutcome, ShotSituation, ShotZone, Side, TeamOfficialSlot } from './constants'

/** A player as entered on the match sheet. Snapshot: never changes when the club roster changes. */
export interface RosterEntry {
  id: string
  side: Side
  teamId: string
  playerId: string
  jersey: number
  name: string
  position: Position | null
  isGoalkeeper: boolean
  isCaptain: boolean
  isStarting: boolean
  isStartingGk: boolean
  photoMediaId: string | null
}

/** A team official entered on the match sheet (slots A-D). */
export interface TeamOfficialEntry {
  id: string
  side: Side
  slot: TeamOfficialSlot
  name: string
  role: string
}

/** One entry of the authoritative match event ledger. */
export interface LedgerEvent {
  id: string
  seq: number
  type: EventType
  side: Side | null
  rosterId: string | null
  teamOfficialId: string | null
  periodSeq: number
  matchMs: number
  outcome: ShotOutcome | null
  situation: ShotSituation | null
  zone: ShotZone | null
  assistRosterId: string | null
  goalkeeperRosterId: string | null
  /** Substitutions: the player coming on. rosterId is the player going off. */
  inRosterId: string | null
  /** Disqualifications: blue card shown, written report required. */
  blueCard: boolean
  /** Disqualifications: whether this decision reduces the team for two minutes on its own. */
  teamReduction: boolean
  /** Links an automatic consequence (e.g. third-suspension disqualification) to its cause. */
  causedByEventId: string | null
  reason: string | null
  status: EventStatus
}

export type CourtStatus = 'court' | 'bench' | 'suspended' | 'disqualified'

/** A running (or finished) team reduction caused by a suspension or disqualification. */
export interface ReductionTimer {
  eventId: string
  side: Side
  kind: 'suspension' | 'disqualification'
  rosterId: string | null
  teamOfficialId: string | null
  /** 1st, 2nd, 3rd suspension of this person (0 for disqualification timers). */
  sequence: number
  startMs: number
  endMs: number
}
