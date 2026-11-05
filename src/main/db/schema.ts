import { sql } from 'drizzle-orm'
import { blob, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { RulesConfig } from '@shared/domain/rules'

/*
 * HMMS database schema. See DATABASE_SCHEMA.md for the design rationale.
 *
 * Conventions
 *  - Primary keys are immutable UUID strings.
 *  - Timestamps are integer milliseconds since the Unix epoch (UTC).
 *  - Match data references match-sheet snapshots (match_rosters), never live club rosters,
 *    so later transfers or edits never rewrite historical matches.
 *  - match_events is the authoritative ledger. Statistics tables are derived caches.
 */

const id = () => text('id').primaryKey()
const createdAt = () => integer('created_at').notNull().default(sql`(unixepoch() * 1000)`)
const updatedAt = () => integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`)

export const users = sqliteTable('users', {
  id: id(),
  username: text('username').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'operator', 'viewer'] }).notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  lastLoginAt: integer('last_login_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (t) => [uniqueIndex('users_username_uq').on(sql`lower(${t.username})`)])

/** Images (team logos, player photos) stored in the database so a backup is a single file. */
export const media = sqliteTable('media', {
  id: id(),
  mime: text('mime').notNull(),
  bytes: blob('bytes', { mode: 'buffer' }).notNull(),
  width: integer('width'),
  height: integer('height'),
  createdAt: createdAt()
})

export const teams = sqliteTable('teams', {
  id: id(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  code: text('code').notNull(),
  country: text('country'),
  region: text('region'),
  clubName: text('club_name'),
  homeVenue: text('home_venue'),
  coach: text('coach'),
  assistantCoach: text('assistant_coach'),
  teamManager: text('team_manager'),
  primaryColor: text('primary_color').notNull().default('#2563eb'),
  secondaryColor: text('secondary_color').notNull().default('#ffffff'),
  logoMediaId: text('logo_media_id').references(() => media.id, { onDelete: 'set null' }),
  captainPlayerId: text('captain_player_id'),
  primaryGoalkeeperId: text('primary_goalkeeper_id'),
  notes: text('notes'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (t) => [index('teams_name_idx').on(t.name)])

export const players = sqliteTable('players', {
  id: id(),
  /** Human-readable permanent registration number, e.g. P-000123. */
  registrationNo: text('registration_no').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  dateOfBirth: text('date_of_birth'),
  gender: text('gender', { enum: ['male', 'female', 'other'] }),
  nationality: text('nationality'),
  position: text('position', {
    enum: ['goalkeeper', 'left_wing', 'right_wing', 'left_back', 'centre_back', 'right_back', 'pivot']
  }),
  heightCm: integer('height_cm'),
  isGoalkeeper: integer('is_goalkeeper', { mode: 'boolean' }).notNull().default(false),
  photoMediaId: text('photo_media_id').references(() => media.id, { onDelete: 'set null' }),
  registrationStatus: text('registration_status', { enum: ['registered', 'pending', 'suspended', 'inactive'] })
    .notNull()
    .default('registered'),
  notes: text('notes'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (t) => [
  uniqueIndex('players_regno_uq').on(t.registrationNo),
  index('players_name_idx').on(t.lastName, t.firstName)
])

/** Team registration history. A row with left_at = NULL is the current registration. */
export const teamPlayers = sqliteTable('team_players', {
  id: id(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'restrict' }),
  playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'restrict' }),
  jerseyNumber: integer('jersey_number').notNull(),
  joinedAt: integer('joined_at').notNull(),
  leftAt: integer('left_at'),
  createdAt: createdAt()
}, (t) => [
  uniqueIndex('team_players_active_jersey_uq').on(t.teamId, t.jerseyNumber).where(sql`${t.leftAt} IS NULL`),
  uniqueIndex('team_players_active_player_uq').on(t.playerId).where(sql`${t.leftAt} IS NULL`),
  index('team_players_team_idx').on(t.teamId)
])

export const venues = sqliteTable('venues', {
  id: id(),
  name: text('name').notNull(),
  city: text('city'),
  address: text('address'),
  capacity: integer('capacity'),
  notes: text('notes'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt()
})

/** Match officials: referees, delegates, timekeepers, scorekeepers. */
export const officials = sqliteTable('officials', {
  id: id(),
  fullName: text('full_name').notNull(),
  role: text('role', { enum: ['referee', 'delegate', 'timekeeper', 'scorekeeper', 'technical_delegate', 'observer'] }).notNull(),
  licenseNo: text('license_no'),
  region: text('region'),
  phone: text('phone'),
  email: text('email'),
  notes: text('notes'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt()
})

export const competitions = sqliteTable('competitions', {
  id: id(),
  name: text('name').notNull(),
  shortName: text('short_name'),
  type: text('type', { enum: ['league', 'knockout', 'groups', 'groups_knockout', 'friendly'] }).notNull(),
  category: text('category'),
  organizer: text('organizer'),
  rules: text('rules', { mode: 'json' }).$type<RulesConfig>().notNull(),
  pointsWin: integer('points_win').notNull().default(2),
  pointsDraw: integer('points_draw').notNull().default(1),
  pointsLoss: integer('points_loss').notNull().default(0),
  tiebreakers: text('tiebreakers', { mode: 'json' }).$type<string[]>().notNull(),
  logoMediaId: text('logo_media_id').references(() => media.id, { onDelete: 'set null' }),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt()
})

export const seasons = sqliteTable('seasons', {
  id: id(),
  competitionId: text('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  startDate: text('start_date'),
  endDate: text('end_date'),
  status: text('status', { enum: ['planned', 'active', 'completed'] }).notNull().default('planned'),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (t) => [index('seasons_comp_idx').on(t.competitionId)])

export const seasonTeams = sqliteTable('season_teams', {
  id: id(),
  seasonId: text('season_id').notNull().references(() => seasons.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'restrict' }),
  groupName: text('group_name'),
  seed: integer('seed'),
  createdAt: createdAt()
}, (t) => [uniqueIndex('season_teams_uq').on(t.seasonId, t.teamId)])

export const matches = sqliteTable('matches', {
  id: id(),
  matchNumber: text('match_number').notNull(),
  competitionId: text('competition_id').references(() => competitions.id, { onDelete: 'set null' }),
  seasonId: text('season_id').references(() => seasons.id, { onDelete: 'set null' }),
  homeTeamId: text('home_team_id').notNull().references(() => teams.id, { onDelete: 'restrict' }),
  awayTeamId: text('away_team_id').notNull().references(() => teams.id, { onDelete: 'restrict' }),
  venueId: text('venue_id').references(() => venues.id, { onDelete: 'set null' }),
  scheduledAt: integer('scheduled_at').notNull(),
  stage: text('stage', {
    enum: ['league', 'group', 'round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final', 'friendly']
  }).notNull().default('league'),
  round: integer('round'),
  groupName: text('group_name'),
  status: text('status', { enum: ['scheduled', 'ready', 'live', 'finished', 'abandoned'] }).notNull().default('scheduled'),
  /** Rule snapshot taken when the match was created. */
  rules: text('rules', { mode: 'json' }).$type<RulesConfig>().notNull(),
  /** Team snapshots for the match sheet (name and colours at the time of the match). */
  homeTeamName: text('home_team_name').notNull(),
  awayTeamName: text('away_team_name').notNull(),
  homeColor: text('home_color').notNull(),
  awayColor: text('away_color').notNull(),
  /** Result fields are written when the match is finalized (cache of the event ledger). */
  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
  homeHalfTime: integer('home_half_time'),
  awayHalfTime: integer('away_half_time'),
  homeShootout: integer('home_shootout'),
  awayShootout: integer('away_shootout'),
  winnerSide: text('winner_side', { enum: ['home', 'away', 'draw'] }),
  decidedBy: text('decided_by', { enum: ['regular', 'overtime', 'shootout'] }),
  spectators: integer('spectators'),
  notes: text('notes'),
  amended: integer('amended', { mode: 'boolean' }).notNull().default(false),
  startedAt: integer('started_at'),
  finalizedAt: integer('finalized_at'),
  finalizedBy: text('finalized_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (t) => [
  uniqueIndex('matches_number_uq').on(t.matchNumber),
  index('matches_status_idx').on(t.status),
  index('matches_scheduled_idx').on(t.scheduledAt),
  index('matches_season_idx').on(t.seasonId)
])

export const matchOfficials = sqliteTable('match_officials', {
  id: id(),
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  officialId: text('official_id').notNull().references(() => officials.id, { onDelete: 'restrict' }),
  role: text('role').notNull(),
  /** Snapshot of the official name on the match sheet. */
  name: text('name').notNull()
}, (t) => [index('match_officials_match_idx').on(t.matchId)])

/** Confirmed lineup per team: snapshot of the team details and confirmation metadata. */
export const matchLineups = sqliteTable('match_lineups', {
  id: id(),
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  side: text('side', { enum: ['home', 'away'] }).notNull(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'restrict' }),
  coachName: text('coach_name'),
  confirmedAt: integer('confirmed_at'),
  confirmedBy: text('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (t) => [uniqueIndex('match_lineups_uq').on(t.matchId, t.side)])

/** Match sheet: snapshot of every player entered for the match. */
export const matchRosters = sqliteTable('match_rosters', {
  id: id(),
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  side: text('side', { enum: ['home', 'away'] }).notNull(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'restrict' }),
  playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'restrict' }),
  jerseyNumber: integer('jersey_number').notNull(),
  playerName: text('player_name').notNull(),
  position: text('position'),
  photoMediaId: text('photo_media_id'),
  isGoalkeeper: integer('is_goalkeeper', { mode: 'boolean' }).notNull().default(false),
  isCaptain: integer('is_captain', { mode: 'boolean' }).notNull().default(false),
  isStarting: integer('is_starting', { mode: 'boolean' }).notNull().default(false),
  isStartingGk: integer('is_starting_gk', { mode: 'boolean' }).notNull().default(false)
}, (t) => [
  uniqueIndex('match_rosters_jersey_uq').on(t.matchId, t.side, t.jerseyNumber),
  uniqueIndex('match_rosters_player_uq').on(t.matchId, t.playerId),
  index('match_rosters_match_idx').on(t.matchId)
])

/** Team officials on the match sheet (A-D). */
export const matchTeamOfficials = sqliteTable('match_team_officials', {
  id: id(),
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  side: text('side', { enum: ['home', 'away'] }).notNull(),
  slot: text('slot', { enum: ['A', 'B', 'C', 'D'] }).notNull(),
  name: text('name').notNull(),
  role: text('role').notNull()
}, (t) => [uniqueIndex('match_team_officials_uq').on(t.matchId, t.side, t.slot)])

/** Persisted match clock and phase. One row per match; written on every state change. */
export const matchClock = sqliteTable('match_clock', {
  matchId: text('match_id').primaryKey().references(() => matches.id, { onDelete: 'cascade' }),
  phase: text('phase', { enum: ['pre_match', 'in_period', 'break', 'finished'] }).notNull(),
  periodSeq: integer('period_seq').notNull().default(0),
  running: integer('running', { mode: 'boolean' }).notNull().default(false),
  /** Playing time accumulated before the current run. */
  baseMs: integer('base_ms').notNull().default(0),
  /** Wall-clock time the current run started (crash recovery only). */
  runStartedWall: integer('run_started_wall'),
  /** Monotonic timestamp (performance.now of the owning process) at which the current run started. */
  runStartedMono: real('run_started_mono'),
  /** Process instance that owns the running clock. A different boot id means the app was restarted. */
  bootId: text('boot_id'),
  /** Last checkpoint of elapsed playing time while running. */
  checkpointMs: integer('checkpoint_ms').notNull().default(0),
  checkpointWall: integer('checkpoint_wall'),
  /** Active team time-out, if any. */
  timeoutId: text('timeout_id'),
  updatedAt: updatedAt()
})

export const matchPeriods = sqliteTable('match_periods', {
  id: id(),
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  kind: text('kind', { enum: ['regular', 'overtime', 'shootout'] }).notNull(),
  label: text('label').notNull(),
  startMs: integer('start_ms').notNull(),
  endMs: integer('end_ms').notNull(),
  startedAt: integer('started_at'),
  endedAt: integer('ended_at'),
  homeScore: integer('home_score'),
  awayScore: integer('away_score')
}, (t) => [uniqueIndex('match_periods_uq').on(t.matchId, t.seq)])

/** The authoritative, append-only match event ledger. Events are voided, never deleted. */
export const matchEvents = sqliteTable('match_events', {
  id: id(),
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  type: text('type').notNull(),
  side: text('side', { enum: ['home', 'away'] }),
  rosterId: text('roster_id').references(() => matchRosters.id, { onDelete: 'restrict' }),
  teamOfficialId: text('team_official_id').references(() => matchTeamOfficials.id, { onDelete: 'restrict' }),
  periodSeq: integer('period_seq').notNull(),
  matchMs: integer('match_ms').notNull(),
  outcome: text('outcome'),
  situation: text('situation'),
  zone: text('zone'),
  assistRosterId: text('assist_roster_id').references(() => matchRosters.id, { onDelete: 'restrict' }),
  goalkeeperRosterId: text('goalkeeper_roster_id').references(() => matchRosters.id, { onDelete: 'restrict' }),
  inRosterId: text('in_roster_id').references(() => matchRosters.id, { onDelete: 'restrict' }),
  blueCard: integer('blue_card', { mode: 'boolean' }).notNull().default(false),
  teamReduction: integer('team_reduction', { mode: 'boolean' }).notNull().default(false),
  causedByEventId: text('caused_by_event_id'),
  reason: text('reason'),
  status: text('status', { enum: ['active', 'voided'] }).notNull().default('active'),
  voidedAt: integer('voided_at'),
  voidedBy: text('voided_by').references(() => users.id, { onDelete: 'set null' }),
  voidReason: text('void_reason'),
  replacesEventId: text('replaces_event_id'),
  /** Idempotency key supplied by the client to reject accidental double submissions. */
  clientRequestId: text('client_request_id'),
  recordedBy: text('recorded_by').references(() => users.id, { onDelete: 'set null' }),
  wallTime: integer('wall_time').notNull()
}, (t) => [
  uniqueIndex('match_events_seq_uq').on(t.matchId, t.seq),
  uniqueIndex('match_events_request_uq').on(t.matchId, t.clientRequestId),
  index('match_events_match_idx').on(t.matchId, t.status),
  index('match_events_roster_idx').on(t.rosterId)
])

/** One record per suspension or disqualification team reduction. Mirrors the ledger. */
export const suspensions = sqliteTable('suspensions', {
  id: id(),
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  eventId: text('event_id').notNull().references(() => matchEvents.id, { onDelete: 'cascade' }),
  side: text('side', { enum: ['home', 'away'] }).notNull(),
  teamId: text('team_id').notNull(),
  rosterId: text('roster_id'),
  playerId: text('player_id'),
  teamOfficialId: text('team_official_id'),
  kind: text('kind', { enum: ['suspension', 'disqualification'] }).notNull(),
  sequence: integer('sequence').notNull(),
  periodSeq: integer('period_seq').notNull(),
  startMs: integer('start_ms').notNull(),
  durationMs: integer('duration_ms').notNull(),
  endMs: integer('end_ms').notNull(),
  status: text('status', { enum: ['active', 'completed', 'cancelled'] }).notNull().default('active'),
  reason: text('reason'),
  recordedBy: text('recorded_by'),
  createdAt: createdAt(),
  completedAt: integer('completed_at')
}, (t) => [index('suspensions_match_idx').on(t.matchId, t.status), index('suspensions_player_idx').on(t.playerId)])

export const substitutions = sqliteTable('substitutions', {
  id: id(),
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  eventId: text('event_id').notNull().references(() => matchEvents.id, { onDelete: 'cascade' }),
  side: text('side', { enum: ['home', 'away'] }).notNull(),
  outRosterId: text('out_roster_id'),
  inRosterId: text('in_roster_id'),
  periodSeq: integer('period_seq').notNull(),
  matchMs: integer('match_ms').notNull(),
  status: text('status', { enum: ['active', 'voided'] }).notNull().default('active'),
  createdAt: createdAt()
}, (t) => [index('substitutions_match_idx').on(t.matchId)])

export const timeouts = sqliteTable('timeouts', {
  id: id(),
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  eventId: text('event_id').notNull().references(() => matchEvents.id, { onDelete: 'cascade' }),
  side: text('side', { enum: ['home', 'away'] }).notNull(),
  teamId: text('team_id').notNull(),
  periodSeq: integer('period_seq').notNull(),
  matchMs: integer('match_ms').notNull(),
  durationMs: integer('duration_ms').notNull(),
  startedWall: integer('started_wall').notNull(),
  endedWall: integer('ended_wall'),
  status: text('status', { enum: ['active', 'completed', 'voided'] }).notNull().default('active')
}, (t) => [index('timeouts_match_idx').on(t.matchId)])

/** Derived standings cache, recomputed from finalized matches. */
export const standings = sqliteTable('standings', {
  id: id(),
  seasonId: text('season_id').notNull().references(() => seasons.id, { onDelete: 'cascade' }),
  groupName: text('group_name').notNull().default(''),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  rank: integer('rank').notNull(),
  played: integer('played').notNull(),
  won: integer('won').notNull(),
  drawn: integer('drawn').notNull(),
  lost: integer('lost').notNull(),
  goalsFor: integer('goals_for').notNull(),
  goalsAgainst: integer('goals_against').notNull(),
  points: integer('points').notNull(),
  updatedAt: updatedAt()
}, (t) => [uniqueIndex('standings_uq').on(t.seasonId, t.groupName, t.teamId)])

/** Derived per-match player statistics cache (rebuilt from the ledger on finalization). */
export const playerStatistics = sqliteTable('player_statistics', {
  id: id(),
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull(),
  rosterId: text('roster_id').notNull(),
  goals: integer('goals').notNull().default(0),
  sevenMetreGoals: integer('seven_metre_goals').notNull().default(0),
  shots: integer('shots').notNull().default(0),
  assists: integer('assists').notNull().default(0),
  steals: integer('steals').notNull().default(0),
  blocks: integer('blocks').notNull().default(0),
  turnovers: integer('turnovers').notNull().default(0),
  technicalFaults: integer('technical_faults').notNull().default(0),
  warnings: integer('warnings').notNull().default(0),
  suspensions: integer('suspensions').notNull().default(0),
  disqualifications: integer('disqualifications').notNull().default(0),
  saves: integer('saves').notNull().default(0),
  shotsFaced: integer('shots_faced').notNull().default(0),
  goalsConceded: integer('goals_conceded').notNull().default(0),
  sevenMetreSaves: integer('seven_metre_saves').notNull().default(0),
  playingTimeMs: integer('playing_time_ms'),
  updatedAt: updatedAt()
}, (t) => [uniqueIndex('player_statistics_uq').on(t.matchId, t.rosterId), index('player_statistics_player_idx').on(t.playerId)])

export const teamStatistics = sqliteTable('team_statistics', {
  id: id(),
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull(),
  side: text('side', { enum: ['home', 'away'] }).notNull(),
  goals: integer('goals').notNull().default(0),
  shots: integer('shots').notNull().default(0),
  shootingPct: real('shooting_pct'),
  technicalFaults: integer('technical_faults').notNull().default(0),
  turnovers: integer('turnovers').notNull().default(0),
  suspensions: integer('suspensions').notNull().default(0),
  timeouts: integer('timeouts').notNull().default(0),
  saves: integer('saves').notNull().default(0),
  savePct: real('save_pct'),
  updatedAt: updatedAt()
}, (t) => [uniqueIndex('team_statistics_uq').on(t.matchId, t.side)])

/** Generated report archive. */
export const matchReports = sqliteTable('match_reports', {
  id: id(),
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  format: text('format', { enum: ['pdf', 'xlsx'] }).notNull(),
  template: text('template').notNull(),
  fileName: text('file_name').notNull(),
  bytes: blob('bytes', { mode: 'buffer' }).notNull(),
  generatedBy: text('generated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt()
}, (t) => [index('match_reports_match_idx').on(t.matchId)])

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: updatedAt()
})

export const auditLogs = sqliteTable('audit_logs', {
  id: id(),
  at: integer('at').notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  username: text('username'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  matchId: text('match_id'),
  before: text('before', { mode: 'json' }),
  after: text('after', { mode: 'json' }),
  note: text('note')
}, (t) => [index('audit_logs_at_idx').on(t.at), index('audit_logs_match_idx').on(t.matchId)])

export const backupHistory = sqliteTable('backup_history', {
  id: id(),
  kind: text('kind', { enum: ['auto', 'manual', 'pre_restore', 'external'] }).notNull(),
  filePath: text('file_path').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  integrity: text('integrity').notNull(),
  note: text('note'),
  createdBy: text('created_by'),
  createdAt: createdAt()
})
