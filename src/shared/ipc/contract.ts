import { z } from 'zod'
import { cameraInputSchema, cameraRef, cameraUpdateSchema, confirmSuggestionSchema, listSuggestionsSchema, pauseAnalysisSchema, rejectSuggestionSchema, setGoalAreasSchema, startAnalysisSchema } from '../schemas/vision'
import type { AnalysisDTO, BallPositionDTO, CameraDTO, CameraFeedDTO, CameraTracksDTO, SuggestionDTO, UsbDevice, VisionModelDTO, VisionStatus } from '../vision'
import type { ChannelDef } from './define'
import { channel } from './define'
import type {
  AppInfo,
  AppSettings,
  AuditDTO,
  AuthStatus,
  BackupDTO,
  BracketDTO,
  CompetitionDTO,
  DashboardDTO,
  IntegrityDTO,
  KnockoutProposalDTO,
  LiveMatchDTO,
  LiveSanctionResultDTO,
  MatchDetailDTO,
  MatchReportDTO,
  MatchSetupDTO,
  MatchSummaryDTO,
  OfficialDTO,
  PlayerDetailDTO,
  PlayerDTO,
  ReportFileDTO,
  SeasonDTO,
  SeasonReportDTO,
  SessionUser,
  StandingRowDTO,
  StatisticsOverviewDTO,
  TeamDetailDTO,
  TeamDTO,
  UserDTO,
  VenueDTO
} from '../dto'
import {
  changeJerseySchema,
  competitionInputSchema,
  competitionUpdateSchema,
  matchInputSchema,
  matchListQuery,
  matchUpdateSchema,
  mediaUploadSchema,
  officialInputSchema,
  officialUpdateSchema,
  playerInputSchema,
  playerListQuery,
  playerUpdateSchema,
  seasonInputSchema,
  seasonTeamsSchema,
  seasonUpdateSchema,
  teamInputSchema,
  teamUpdateSchema,
  transferSchema,
  venueInputSchema,
  venueUpdateSchema
} from '../schemas/entities'
import { changePasswordSchema, createUserSchema, loginSchema, setupSchema, updateUserSchema } from '../schemas/auth'
import { appSettingsPatchSchema } from '../schemas/settings'
import { idInput, listQuery, noInput } from '../schemas/common'
import { saveLineupSchema, sideInputSchema } from '../schemas/lineup'
import {
  clockActionSchema,
  editEventSchema,
  endPeriodSchema,
  finishMatchSchema,
  matchRef,
  recordEventSchema,
  recoverClockSchema,
  sanctionSchema,
  setClockSchema,
  startTimeoutSchema,
  voidEventSchema
} from '../schemas/live'
import { createKnockoutSchema, generateFixturesSchema, generateReportSchema, knockoutProposalSchema, reportListQuery, saveSeasonReportSchema, scheduleTieSchema, seasonRef, statisticsQuery } from '../schemas/reports'

const archiveInput = z.object({ id: z.string().uuid(), archived: z.boolean() })

/**
 * The complete IPC contract between renderer and main process.
 * Every channel declares its input schema (validated in main), its required permission and
 * its output type. The renderer can only reach these channels through the preload bridge.
 */
export const contract = {
  // application
  'app.info': channel<AppInfo>()('public', noInput),
  'app.openDataFolder': channel<void>()('admin', noInput),
  'app.openLogFolder': channel<void>()('authenticated', noInput),

  // AI Vision. Starting the service needs the same permission as running a match.
  'vision.status': channel<VisionStatus>()('authenticated', noInput),
  'vision.start': channel<VisionStatus>()('operate_match', noInput),
  'vision.stop': channel<VisionStatus>()('operate_match', noInput),
  'vision.discover': channel<UsbDevice[]>()('operate_match', noInput),
  'vision.feeds': channel<CameraFeedDTO[]>()('authenticated', noInput),
  'vision.openCamera': channel<void>()('operate_match', cameraRef),
  'vision.closeCamera': channel<void>()('operate_match', cameraRef),
  'vision.analysis': channel<AnalysisDTO>()('authenticated', noInput),
  'vision.startAnalysis': channel<void>()('operate_match', startAnalysisSchema),
  'vision.stopAnalysis': channel<void>()('operate_match', noInput),
  'vision.pauseAnalysis': channel<void>()('operate_match', pauseAnalysisSchema),
  'vision.models': channel<VisionModelDTO[]>()('authenticated', noInput),
  'suggestions.list': channel<SuggestionDTO[]>()('authenticated', listSuggestionsSchema),
  'suggestions.confirm': channel<LiveMatchDTO>()('operate_match', confirmSuggestionSchema),
  'suggestions.reject': channel<void>()('operate_match', rejectSuggestionSchema),
  'cameras.list': channel<CameraDTO[]>()('authenticated', noInput),
  'cameras.create': channel<CameraDTO>()('manage_data', cameraInputSchema),
  'cameras.update': channel<CameraDTO>()('manage_data', cameraUpdateSchema),
  'cameras.delete': channel<void>()('manage_data', cameraRef),
  'cameras.chooseVideo': channel<{ path: string } | null>()('manage_data', noInput),
  'cameras.setGoalAreas': channel<void>()('operate_match', setGoalAreasSchema),
  'cameras.swapEnds': channel<void>()('operate_match', cameraRef),

  'app.reportError': channel<void>()(
    'public',
    z.object({ message: z.string().max(2000), stack: z.string().max(8000).nullable(), route: z.string().max(300) })
  ),

  // authentication & users
  'auth.status': channel<AuthStatus>()('public', noInput),
  'auth.setup': channel<SessionUser>()('public', setupSchema),
  'auth.login': channel<SessionUser>()('public', loginSchema),
  'auth.logout': channel<void>()('public', noInput),
  'auth.changePassword': channel<void>()('authenticated', changePasswordSchema),
  'users.list': channel<UserDTO[]>()('admin', noInput),
  'users.create': channel<UserDTO>()('admin', createUserSchema),
  'users.update': channel<UserDTO>()('admin', updateUserSchema),

  // settings
  'settings.get': channel<AppSettings>()('public', noInput),
  'settings.update': channel<AppSettings>()('admin', appSettingsPatchSchema),

  // backup, restore & integrity
  'backup.list': channel<BackupDTO[]>()('admin', noInput),
  'backup.create': channel<BackupDTO>()('manage_data', z.object({ note: z.string().max(200).optional() })),
  'backup.exportToFolder': channel<{ path: string } | null>()('manage_data', noInput),
  'backup.restoreFromFile': channel<{ restored: boolean; preRestoreBackup?: string }>()('admin', noInput),
  'backup.restoreFromHistory': channel<{ restored: boolean; preRestoreBackup?: string }>()('admin', idInput),
  'db.integrity': channel<IntegrityDTO>()('authenticated', noInput),
  'audit.list': channel<AuditDTO[]>()(
    'authenticated',
    z.object({
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
      matchId: z.string().uuid().optional()
    })
  ),

  // dashboard & media
  'dashboard.get': channel<DashboardDTO>()('authenticated', noInput),
  'media.upload': channel<{ id: string }>()('manage_data', mediaUploadSchema),

  // teams
  'teams.list': channel<TeamDTO[]>()('authenticated', listQuery),
  'teams.get': channel<TeamDetailDTO>()('authenticated', idInput),
  'teams.create': channel<TeamDetailDTO>()('manage_data', teamInputSchema),
  'teams.update': channel<TeamDetailDTO>()('manage_data', teamUpdateSchema),
  'teams.archive': channel<TeamDTO>()('manage_data', archiveInput),

  // players
  'players.list': channel<PlayerDTO[]>()('authenticated', playerListQuery),
  'players.get': channel<PlayerDetailDTO>()('authenticated', idInput),
  'players.create': channel<PlayerDTO>()('manage_data', playerInputSchema),
  'players.update': channel<PlayerDTO>()('manage_data', playerUpdateSchema),
  'players.archive': channel<PlayerDTO>()('manage_data', archiveInput),
  'players.transfer': channel<PlayerDTO>()('manage_data', transferSchema),
  'players.changeJersey': channel<PlayerDTO>()('manage_data', changeJerseySchema),

  // officials & venues
  'officials.list': channel<OfficialDTO[]>()('authenticated', listQuery),
  'officials.create': channel<OfficialDTO>()('manage_data', officialInputSchema),
  'officials.update': channel<OfficialDTO>()('manage_data', officialUpdateSchema),
  'officials.archive': channel<OfficialDTO>()('manage_data', archiveInput),
  'venues.list': channel<VenueDTO[]>()('authenticated', listQuery),
  'venues.create': channel<VenueDTO>()('manage_data', venueInputSchema),
  'venues.update': channel<VenueDTO>()('manage_data', venueUpdateSchema),
  'venues.archive': channel<VenueDTO>()('manage_data', archiveInput),

  // competitions & seasons
  'competitions.list': channel<CompetitionDTO[]>()('authenticated', listQuery),
  'competitions.get': channel<CompetitionDTO>()('authenticated', idInput),
  'competitions.create': channel<CompetitionDTO>()('manage_data', competitionInputSchema),
  'competitions.update': channel<CompetitionDTO>()('manage_data', competitionUpdateSchema),
  'competitions.archive': channel<CompetitionDTO>()('manage_data', archiveInput),
  'seasons.create': channel<SeasonDTO>()('manage_data', seasonInputSchema),
  'seasons.update': channel<SeasonDTO>()('manage_data', seasonUpdateSchema),
  'seasons.setTeams': channel<SeasonDTO>()('manage_data', seasonTeamsSchema),
  'seasons.standings': channel<StandingRowDTO[]>()('authenticated', idInput),

  // matches
  'matches.list': channel<MatchSummaryDTO[]>()('authenticated', matchListQuery),
  'matches.get': channel<MatchDetailDTO>()('authenticated', idInput),
  'matches.create': channel<MatchDetailDTO>()('manage_data', matchInputSchema),
  'matches.update': channel<MatchDetailDTO>()('manage_data', matchUpdateSchema),
  'matches.delete': channel<void>()('manage_data', idInput),

  // lineups (match sheet)
  'lineups.get': channel<MatchSetupDTO>()('authenticated', idInput),
  'lineups.save': channel<MatchSetupDTO>()('operate_match', saveLineupSchema),
  'lineups.confirm': channel<MatchSetupDTO>()('operate_match', sideInputSchema),
  'lineups.reopen': channel<MatchSetupDTO>()('operate_match', sideInputSchema),

  // live match centre
  'live.get': channel<LiveMatchDTO>()('authenticated', matchRef),
  'live.startPeriod': channel<LiveMatchDTO>()('operate_match', matchRef),
  'live.clock': channel<LiveMatchDTO>()('operate_match', clockActionSchema),
  'live.setClock': channel<LiveMatchDTO>()('operate_match', setClockSchema),
  'live.recoverClock': channel<LiveMatchDTO>()('operate_match', recoverClockSchema),
  'live.endPeriod': channel<LiveMatchDTO>()('operate_match', endPeriodSchema),
  'live.finish': channel<LiveMatchDTO>()('operate_match', finishMatchSchema),
  'live.record': channel<LiveMatchDTO>()('operate_match', recordEventSchema),
  'live.edit': channel<LiveMatchDTO>()('operate_match', editEventSchema),
  'live.void': channel<LiveMatchDTO>()('operate_match', voidEventSchema),
  'live.sanction': channel<LiveSanctionResultDTO>()('operate_match', sanctionSchema),
  'live.timeoutStart': channel<LiveMatchDTO>()('operate_match', startTimeoutSchema),
  'live.timeoutEnd': channel<LiveMatchDTO>()('operate_match', matchRef),
  'live.openScoreboard': channel<void>()('authenticated', matchRef),

  // fixtures and knockout rounds
  'fixtures.generate': channel<{ created: number }>()('manage_data', generateFixturesSchema),
  'fixtures.clear': channel<{ deleted: number }>()('manage_data', seasonRef),
  'knockout.get': channel<BracketDTO>()('authenticated', seasonRef),
  'knockout.proposal': channel<KnockoutProposalDTO>()('authenticated', knockoutProposalSchema),
  'knockout.create': channel<BracketDTO>()('manage_data', createKnockoutSchema),
  'knockout.schedule': channel<BracketDTO>()('manage_data', scheduleTieSchema),
  'knockout.clear': channel<void>()('manage_data', seasonRef),

  // statistics and reports
  'seasons.report': channel<SeasonReportDTO>()('authenticated', seasonRef),
  'seasons.saveReport': channel<{ path: string } | null>()('authenticated', saveSeasonReportSchema),
  'seasons.printReport': channel<{ printed: boolean }>()('authenticated', seasonRef),
  'statistics.overview': channel<StatisticsOverviewDTO>()('authenticated', statisticsQuery),
  'statistics.export': channel<{ path: string } | null>()('authenticated', statisticsQuery),
  'reports.get': channel<MatchReportDTO>()('authenticated', matchRef),
  'reports.list': channel<ReportFileDTO[]>()('authenticated', reportListQuery),
  'reports.generate': channel<ReportFileDTO>()('operate_match', generateReportSchema),
  'reports.saveAs': channel<{ path: string } | null>()('authenticated', idInput),
  'reports.print': channel<{ printed: boolean }>()('authenticated', matchRef),

  // demonstration mode
  'demo.enter': channel<void>()('public', noInput),
  'demo.exit': channel<void>()('public', noInput)
} satisfies Record<string, ChannelDef<z.ZodType, unknown>>

export type Contract = typeof contract
export type ChannelName = keyof Contract
export type ChannelInput<K extends ChannelName> = z.input<Contract[K]['input']>
export type ChannelParsed<K extends ChannelName> = z.output<Contract[K]['input']>
export type ChannelOutput<K extends ChannelName> = Contract[K] extends ChannelDef<z.ZodType, infer O> ? O : never

/** Push events from main to renderer windows. */
export interface PushEvents {
  /** The vision service changed state, or sent fresh health figures. */
  'vision.status': VisionStatus
  /** A camera connected, dropped or changed. Pictures are fetched separately, not pushed. */
  'vision.feeds': CameraFeedDTO[]
  'vision.analysis': AnalysisDTO
  /** Boxes for one analysed frame. Estimates only, and they never reach the match record. */
  'vision.tracks': CameraTracksDTO
  /** Where the ball seems to be. A marker for the screen, and nothing more. */
  'vision.ball': BallPositionDTO
  /** The review queue of this match changed. */
  'suggestions.changed': { matchId: string }
  'session.changed': { user: SessionUser | null }
  'data.reloaded': { mode: 'production' | 'demo' }
  'settings.changed': AppSettings
  /** A live match changed (event recorded, clock started/stopped, period changed). */
  'live.changed': { matchId: string }
}
export type PushEventName = keyof PushEvents
