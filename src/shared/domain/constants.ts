/** Playing positions supported by HMMS (IHF terminology with common aliases). */
export const POSITIONS = [
  'goalkeeper',
  'left_wing',
  'right_wing',
  'left_back',
  'centre_back',
  'right_back',
  'pivot'
] as const
export type Position = (typeof POSITIONS)[number]

export const POSITION_LABELS: Record<Position, string> = {
  goalkeeper: 'Goalkeeper',
  left_wing: 'Left Wing',
  right_wing: 'Right Wing',
  left_back: 'Left Back',
  centre_back: 'Centre Back / Playmaker',
  right_back: 'Right Back',
  pivot: 'Pivot / Line Player'
}

export const POSITION_SHORT: Record<Position, string> = {
  goalkeeper: 'GK',
  left_wing: 'LW',
  right_wing: 'RW',
  left_back: 'LB',
  centre_back: 'CB',
  right_back: 'RB',
  pivot: 'PV'
}

export const GENDERS = ['male', 'female', 'other'] as const
export type Gender = (typeof GENDERS)[number]

export const REGISTRATION_STATUSES = ['registered', 'pending', 'suspended', 'inactive'] as const
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number]

export const ROLES = ['admin', 'operator', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  'public',
  'authenticated',
  'manage_data',
  'operate_match',
  'correct_finalized',
  'admin'
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: ['public', 'authenticated', 'manage_data', 'operate_match', 'correct_finalized', 'admin'],
  operator: ['public', 'authenticated', 'manage_data', 'operate_match'],
  viewer: ['public', 'authenticated']
}

export const OFFICIAL_ROLES = [
  'referee',
  'delegate',
  'timekeeper',
  'scorekeeper',
  'technical_delegate',
  'observer'
] as const
export type OfficialRole = (typeof OFFICIAL_ROLES)[number]

export const OFFICIAL_ROLE_LABELS: Record<OfficialRole, string> = {
  referee: 'Referee',
  delegate: 'Match Delegate',
  timekeeper: 'Timekeeper',
  scorekeeper: 'Scorekeeper / Secretary',
  technical_delegate: 'Technical Delegate',
  observer: 'Referee Observer'
}

export const COMPETITION_TYPES = ['league', 'knockout', 'groups', 'groups_knockout', 'friendly'] as const
export type CompetitionType = (typeof COMPETITION_TYPES)[number]

export const COMPETITION_TYPE_LABELS: Record<CompetitionType, string> = {
  league: 'League',
  knockout: 'Knockout',
  groups: 'Group stage',
  groups_knockout: 'Group stage + Knockout',
  friendly: 'Friendly'
}

export const MATCH_STAGES = ['league', 'group', 'round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final', 'friendly'] as const
export type MatchStage = (typeof MATCH_STAGES)[number]

export const MATCH_STAGE_LABELS: Record<MatchStage, string> = {
  league: 'League',
  group: 'Group',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-final',
  semi_final: 'Semi-final',
  third_place: 'Third place',
  final: 'Final',
  friendly: 'Friendly'
}

/** Lifecycle of a match record. */
export const MATCH_STATUSES = ['scheduled', 'ready', 'live', 'finished', 'abandoned'] as const
export type MatchStatus = (typeof MATCH_STATUSES)[number]

export type Side = 'home' | 'away'
export const SIDES: readonly Side[] = ['home', 'away']
export const otherSide = (s: Side): Side => (s === 'home' ? 'away' : 'home')

/** Team official slots on the match sheet (IHF Rule 4:2 allows up to four: A–D). */
export const TEAM_OFFICIAL_SLOTS = ['A', 'B', 'C', 'D'] as const
export type TeamOfficialSlot = (typeof TEAM_OFFICIAL_SLOTS)[number]

/** Match event ledger types. */
export const EVENT_TYPES = [
  'shot',
  'technical_fault',
  'turnover',
  'steal',
  'block',
  'warning',
  'suspension',
  'disqualification',
  'timeout',
  'substitution',
  'period_start',
  'period_end',
  'clock_adjust',
  'note'
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const SHOT_OUTCOMES = ['goal', 'saved', 'missed', 'blocked', 'post'] as const
export type ShotOutcome = (typeof SHOT_OUTCOMES)[number]

export const SHOT_OUTCOME_LABELS: Record<ShotOutcome, string> = {
  goal: 'Goal',
  saved: 'Saved',
  missed: 'Missed',
  blocked: 'Blocked',
  post: 'Post / Crossbar'
}

/**
 * Attack situation of a shot — HOW the chance was created.
 * Kept separate from the shot zone (WHERE it was taken from) so the two are never confused.
 */
export const SHOT_SITUATIONS = ['positional', 'fast_break', 'seven_metre', 'empty_goal', 'shootout'] as const
export type ShotSituation = (typeof SHOT_SITUATIONS)[number]

export const SHOT_SITUATION_LABELS: Record<ShotSituation, string> = {
  positional: 'Positional attack',
  fast_break: 'Fast break',
  seven_metre: '7-metre throw',
  empty_goal: 'Empty goal',
  shootout: 'Penalty shoot-out'
}

export const SHOT_ZONES = ['wing', 'backcourt', 'pivot', 'breakthrough'] as const
export type ShotZone = (typeof SHOT_ZONES)[number]

export const SHOT_ZONE_LABELS: Record<ShotZone, string> = {
  wing: 'Wing',
  backcourt: 'Backcourt (9 m)',
  pivot: 'Pivot (6 m)',
  breakthrough: 'Breakthrough'
}

export const EVENT_STATUS = ['active', 'voided'] as const
export type EventStatus = (typeof EVENT_STATUS)[number]
