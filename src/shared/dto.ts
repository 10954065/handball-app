import type {
  CompetitionType,
  EventStatus,
  EventType,
  Gender,
  MatchStage,
  MatchStatus,
  OfficialRole,
  Permission,
  Position,
  RegistrationStatus,
  Role,
  ShotOutcome,
  ShotSituation,
  ShotZone,
  Side
} from './domain/constants'
import type { ShootoutStatus } from './domain/flow'
import type { ClockPhase } from './domain/live'
import type { PeriodDef } from './domain/periods'
import type { RulesConfig } from './domain/rules'
import type { TeamTally } from './domain/tally'
import type { CourtStatus } from './domain/types'
import type { AppSettings } from './schemas/settings'

export interface SessionUser {
  id: string
  username: string
  displayName: string
  role: Role
  permissions: Permission[]
}

export type DataMode = 'production' | 'demo'

export interface AppInfo {
  name: string
  version: string
  mode: DataMode
  dataDir: string
  dbFile: string
  backupDir: string
  logDir: string
  electron: string
  chrome: string
  node: string
  sqlite: string
  platform: string
}

export interface AuthStatus {
  needsSetup: boolean
  user: SessionUser | null
  mode: DataMode
}

export interface UserDTO {
  id: string
  username: string
  displayName: string
  role: Role
  active: boolean
  lastLoginAt: number | null
  createdAt: number
}

export interface BackupDTO {
  id: string
  kind: 'auto' | 'manual' | 'pre_restore' | 'external'
  filePath: string
  fileName: string
  sizeBytes: number
  sha256: string
  integrity: string
  note: string | null
  createdAt: number
  exists: boolean
}

export interface IntegrityDTO {
  ok: boolean
  integrity: string[]
  foreignKeyViolations: number
  checkedAt: number
}

export interface AuditDTO {
  id: string
  at: number
  username: string | null
  action: string
  entity: string
  entityId: string | null
  matchId: string | null
  note: string | null
  before: unknown
  after: unknown
}

export type { AppSettings }

// ---------------------------------------------------------------- administration (phase 2)

export interface TeamDTO {
  id: string
  name: string
  shortName: string
  code: string
  country: string | null
  region: string | null
  clubName: string | null
  homeVenue: string | null
  coach: string | null
  assistantCoach: string | null
  teamManager: string | null
  primaryColor: string
  secondaryColor: string
  logoMediaId: string | null
  captainPlayerId: string | null
  primaryGoalkeeperId: string | null
  notes: string | null
  archived: boolean
  playerCount: number
  createdAt: number
}

export interface RosterPlayerDTO {
  playerId: string
  registrationNo: string
  fullName: string
  firstName: string
  lastName: string
  jerseyNumber: number
  position: Position | null
  isGoalkeeper: boolean
  isCaptain: boolean
  isPrimaryGoalkeeper: boolean
  photoMediaId: string | null
  registrationStatus: RegistrationStatus
  dateOfBirth: string | null
}

export interface TeamDetailDTO extends TeamDTO {
  roster: RosterPlayerDTO[]
  competitions: { seasonId: string; seasonName: string; competitionId: string; competitionName: string; groupName: string | null }[]
}

export interface PlayerDTO {
  id: string
  registrationNo: string
  firstName: string
  lastName: string
  fullName: string
  dateOfBirth: string | null
  gender: Gender | null
  nationality: string | null
  position: Position | null
  heightCm: number | null
  isGoalkeeper: boolean
  photoMediaId: string | null
  registrationStatus: RegistrationStatus
  notes: string | null
  archived: boolean
  teamId: string | null
  teamName: string | null
  teamColor: string | null
  jerseyNumber: number | null
  isCaptain: boolean
}

export interface RegistrationHistoryDTO {
  id: string
  teamId: string
  teamName: string
  jerseyNumber: number
  joinedAt: number
  leftAt: number | null
}

export interface PlayerMatchDTO {
  matchId: string
  matchNumber: string
  scheduledAt: number
  status: MatchStatus
  teamName: string
  opponentName: string
  jerseyNumber: number
  isStarting: boolean
  goals: number
  shots: number
  warnings: number
  suspensions: number
  disqualifications: number
}

export interface PlayerTotalsDTO {
  matches: number
  goals: number
  sevenMetreGoals: number
  shots: number
  assists: number
  steals: number
  turnovers: number
  technicalFaults: number
  blocks: number
  warnings: number
  suspensions: number
  disqualifications: number
  saves: number
  shotsFaced: number
}

export interface PlayerDetailDTO extends PlayerDTO {
  history: RegistrationHistoryDTO[]
  matches: PlayerMatchDTO[]
  totals: PlayerTotalsDTO
  competitions: string[]
}

export interface OfficialDTO {
  id: string
  fullName: string
  role: OfficialRole
  licenseNo: string | null
  region: string | null
  phone: string | null
  email: string | null
  notes: string | null
  archived: boolean
  matchCount: number
}

export interface VenueDTO {
  id: string
  name: string
  city: string | null
  address: string | null
  capacity: number | null
  notes: string | null
  archived: boolean
}

export interface SeasonDTO {
  id: string
  competitionId: string
  name: string
  startDate: string | null
  endDate: string | null
  status: 'planned' | 'active' | 'completed'
  teams: { teamId: string; teamName: string; code: string; primaryColor: string; logoMediaId: string | null; groupName: string | null }[]
  matchCount: number
}

export interface CompetitionDTO {
  id: string
  name: string
  shortName: string | null
  type: CompetitionType
  category: string | null
  organizer: string | null
  rules: RulesConfig
  pointsWin: number
  pointsDraw: number
  pointsLoss: number
  tiebreakers: string[]
  logoMediaId: string | null
  archived: boolean
  seasons: SeasonDTO[]
}

export interface MatchSummaryDTO {
  id: string
  matchNumber: string
  scheduledAt: number
  status: MatchStatus
  stage: MatchStage
  round: number | null
  groupName: string | null
  competitionId: string | null
  competitionName: string | null
  seasonId: string | null
  seasonName: string | null
  venueId: string | null
  venueName: string | null
  home: { teamId: string; name: string; code: string; color: string; logoMediaId: string | null }
  away: { teamId: string; name: string; code: string; color: string; logoMediaId: string | null }
  homeScore: number | null
  awayScore: number | null
  homeShootout: number | null
  awayShootout: number | null
  winnerSide: 'home' | 'away' | 'draw' | null
  lineupsConfirmed: { home: boolean; away: boolean }
}

export interface MatchDetailDTO extends MatchSummaryDTO {
  rules: RulesConfig
  notes: string | null
  officials: { officialId: string; name: string; role: string }[]
  amended: boolean
}

export interface DashboardDTO {
  totals: { competitions: number; teams: number; players: number; matchesPlayed: number; officials: number }
  liveMatches: MatchSummaryDTO[]
  upcoming: MatchSummaryDTO[]
  recentResults: MatchSummaryDTO[]
  activity: AuditDTO[]
  topScorers: { playerId: string; name: string; teamName: string | null; photoMediaId: string | null; goals: number; matches: number }[]
  standings: { seasonId: string; title: string; rows: StandingRowDTO[] } | null
}

export interface StandingRowDTO {
  rank: number
  teamId: string
  teamName: string
  code: string
  logoMediaId: string | null
  primaryColor: string
  groupName: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
}

// ---------------------------------------------------------------- lineups (phase 3)

export interface SquadPlayerDTO {
  playerId: string
  fullName: string
  jerseyNumber: number
  position: Position | null
  isGoalkeeper: boolean
  photoMediaId: string | null
  isTeamCaptain: boolean
  isPrimaryGoalkeeper: boolean
  eligible: boolean
  ineligibleReason: string | null
}

export interface LineupEntryDTO {
  rosterId: string
  playerId: string
  jerseyNumber: number
  name: string
  position: Position | null
  photoMediaId: string | null
  isGoalkeeper: boolean
  isStarting: boolean
  isStartingGk: boolean
  isCaptain: boolean
}

export interface TeamOfficialDTO {
  id: string
  slot: 'A' | 'B' | 'C' | 'D'
  name: string
  role: string
}

export interface SideSetupDTO {
  side: 'home' | 'away'
  teamId: string
  teamName: string
  code: string
  color: string
  logoMediaId: string | null
  coach: string | null
  assistantCoach: string | null
  teamManager: string | null
  squad: SquadPlayerDTO[]
  entries: LineupEntryDTO[]
  officials: TeamOfficialDTO[]
  confirmedAt: number | null
  confirmedBy: string | null
  validation: { errors: string[]; warnings: string[] }
}

export interface MatchSetupDTO {
  match: MatchDetailDTO
  /** True once the match has started: the match sheet is then read-only. */
  locked: boolean
  home: SideSetupDTO
  away: SideSetupDTO
}

// ---------------------------------------------------------------------------------------------
// Live match (phase 4)
// ---------------------------------------------------------------------------------------------

export interface LivePlayerDTO {
  rosterId: string
  jerseyNumber: number
  name: string
  position: Position | null
  photoMediaId: string | null
  isGoalkeeper: boolean
  isCaptain: boolean
  status: CourtStatus
  goals: number
  shots: number
  assists: number
  saves: number
  shotsFaced: number
}

export interface LiveSideDTO {
  side: Side
  teamId: string
  name: string
  code: string
  color: string
  logoMediaId: string | null
  score: number
  shootoutScore: number
  players: LivePlayerDTO[]
  officials: TeamOfficialDTO[]
  onCourt: number
  allowedOnCourt: number
  stats: TeamTally
}

export interface LiveEventPlayer {
  rosterId: string
  jerseyNumber: number
  name: string
}

export interface LiveEventDTO {
  id: string
  seq: number
  type: EventType
  side: Side | null
  periodSeq: number
  periodLabel: string
  matchMs: number
  outcome: ShotOutcome | null
  situation: ShotSituation | null
  zone: ShotZone | null
  player: LiveEventPlayer | null
  assist: LiveEventPlayer | null
  goalkeeper: LiveEventPlayer | null
  inPlayer: LiveEventPlayer | null
  /** Note text, clock adjustment reason or correction reason. */
  text: string | null
  status: EventStatus
  voidReason: string | null
  replacesEventId: string | null
  recordedBy: string | null
  wallTime: number
  /** Score after this event (goals only). */
  scoreAfter: { home: number; away: number } | null
  /** Whether the operator may void or edit this event. */
  correctable: boolean
  editable: boolean
}

export interface LiveClockDTO {
  phase: ClockPhase
  periodSeq: number
  running: boolean
  elapsedMs: number
  /** The application was closed while the clock was running; the operator must choose the time. */
  needsRecovery: boolean
  recovery: { checkpointMs: number; checkpointWall: number | null; wallElapsedMs: number | null } | null
}

export interface LiveMatchDTO {
  match: MatchDetailDTO
  plan: PeriodDef[]
  period: PeriodDef | null
  /** The next period to start from a break, or null when the match can be finished. */
  nextPeriod: PeriodDef | null
  clock: LiveClockDTO
  home: LiveSideDTO
  away: LiveSideDTO
  /** Newest first, including voided events (shown struck through). */
  events: LiveEventDTO[]
  periodScores: { periodSeq: number; label: string; home: number; away: number }[]
  shootout: ShootoutStatus | null
  canFinish: boolean
  breakStartedWall: number | null
  serverWall: number
}
