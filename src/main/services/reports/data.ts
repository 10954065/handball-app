import { createHash } from 'node:crypto'
import { asc, eq, inArray } from 'drizzle-orm'
import type { Side } from '@shared/domain/constants'
import { eventDetail, eventTitle } from '@shared/domain/event-labels'
import { activeEvents } from '@shared/domain/ledger'
import { formatMatchTime } from '@shared/domain/periods'
import { appearances, biggestLead, goalsByPeriod, scoreFlow, shootingBreakdown } from '@shared/domain/statistics'
import { emptyPlayerTally, liveTallies, type Tallies } from '@shared/domain/tally'
import type { LedgerEvent } from '@shared/domain/types'
import type { LiveEventDTO, MatchReportDTO, ReportCorrectionDTO, ReportEventDTO, ReportSideDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import { matchEvents, users } from '../../db/schema'
import type { Ctx } from '../ctx'
import { liveEvents } from '../live/dto'
import { currentShootout, type LiveData, loadLive, stateNow, toLedger } from '../live/state'
import { getSettings } from '../settings'

/** Fingerprint of a ledger, voided entries included: any correction changes it. */
export function ledgerDigest(events: readonly LedgerEvent[]): string {
  const ordered = [...events].sort((a, b) => a.seq - b.seq)
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex')
}

export function currentLedgerDigest(ctx: Ctx, matchId: string): string {
  return ledgerDigest(ctx.db.select().from(matchEvents).where(eq(matchEvents.matchId, matchId)).orderBy(asc(matchEvents.seq)).all().map(toLedger))
}

/** The times of a person's sanctions, as they are written on a match report. */
function sanctionMarks(events: readonly LedgerEvent[], own: (e: LedgerEvent) => boolean) {
  const mine = events.filter(own)
  const times = (type: LedgerEvent['type']) => mine.filter((e) => e.type === type).map((e) => formatMatchTime(e.matchMs))
  const red = mine.find((e) => e.type === 'disqualification')
  return {
    warningsAt: times('warning'),
    suspensionsAt: times('suspension'),
    disqualifiedAt: red ? formatMatchTime(red.matchMs) : null,
    blueCard: !!red?.blueCard
  }
}

function reportSide(d: LiveData, side: Side, tallies: Tallies, played: Set<string>): ReportSideDTO {
  const team = side === 'home' ? d.detail.home : d.detail.away
  const active = activeEvents(d.events)
  const state = stateNow(d)
  const shootout = currentShootout(d)
  return {
    side,
    teamId: team.teamId,
    name: team.name,
    code: team.code,
    color: team.color,
    logoMediaId: team.logoMediaId,
    score: state[side].score,
    halfTime: state.scoreByPeriod.get(1)?.[side] ?? null,
    shootout: shootout ? shootout[side] : null,
    stats: tallies.teams[side],
    shooting: shootingBreakdown(d.events, side),
    timeoutsAt: active.filter((e) => e.type === 'timeout' && e.side === side).map((e) => formatMatchTime(e.matchMs)),
    players: d.roster
      .filter((r) => r.side === side)
      .map((r) => ({
        rosterId: r.id,
        playerId: r.playerId,
        jerseyNumber: r.jersey,
        name: r.name,
        isGoalkeeper: r.isGoalkeeper,
        isCaptain: r.isCaptain,
        isStarting: r.isStarting,
        played: played.has(r.id),
        stats: tallies.players.get(r.id) ?? emptyPlayerTally(),
        ...sanctionMarks(active, (e) => e.rosterId === r.id)
      })),
    officials: d.officials
      .filter((o) => o.side === side)
      .map((o) => ({ slot: o.slot, name: o.name, role: o.role, ...sanctionMarks(active, (e) => e.teamOfficialId === o.id) }))
  }
}

const KEY_TYPES = new Set(['warning', 'suspension', 'disqualification', 'timeout', 'period_start', 'period_end', 'note'])

const isKeyEvent = (e: LiveEventDTO) => KEY_TYPES.has(e.type) || (e.type === 'shot' && (e.outcome === 'goal' || e.situation === 'shootout'))

function whoOf(e: LiveEventDTO): string {
  if (e.player) return `#${e.player.jerseyNumber} ${e.player.name}`
  if (e.official) return `Official ${e.official.slot} ${e.official.name}`
  return ''
}

function reportEvent(e: LiveEventDTO, d: LiveData): ReportEventDTO {
  return {
    id: e.id,
    time: formatMatchTime(e.matchMs),
    periodLabel: e.periodLabel,
    side: e.side,
    title: eventTitle(e, d),
    who: whoOf(e),
    detail: eventDetail(e),
    score: e.scoreAfter ? `${e.scoreAfter.home}:${e.scoreAfter.away}` : null,
    key: isKeyEvent(e)
  }
}

/** Voided entries and clock corrections, printed on every report so nothing is hidden. */
function corrections(ctx: Ctx, d: LiveData, events: LiveEventDTO[]): ReportCorrectionDTO[] {
  const rowById = new Map(d.rows.map((r) => [r.id, r]))
  const ids = [...new Set(d.rows.flatMap((r) => [r.voidedBy, r.recordedBy]).filter((x): x is string => !!x))]
  const names = new Map(ids.length ? ctx.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ids)).all().map((u) => [u.id, u.name]) : [])
  return events
    .filter((e) => e.status === 'voided' || e.type === 'clock_adjust')
    .map((e) => {
      const row = rowById.get(e.id)
      const voided = e.status === 'voided'
      const user = voided ? row?.voidedBy : row?.recordedBy
      return {
        id: e.id,
        time: formatMatchTime(e.matchMs),
        title: eventTitle(e, d),
        who: whoOf(e),
        kind: voided ? ('voided' as const) : ('clock' as const),
        reason: (voided ? e.voidReason : e.text) ?? '',
        by: user ? (names.get(user) ?? null) : null
      }
    })
}

/** The whole report of a match, built from its event ledger. */
export function matchReport(ctx: Ctx, matchId: string): MatchReportDTO {
  const d = loadLive(ctx, matchId)
  if (d.row.status === 'scheduled') throw new AppError('CONFLICT', 'A match report needs both lineups to be confirmed.')
  const settings = getSettings(ctx)
  const tallies = liveTallies(d.events)
  const played = appearances(d.events, d.roster)
  const flow = scoreFlow(d.events)
  const ordered = [...liveEvents(ctx, d, false)].reverse()
  const finalizer = d.row.finalizedBy ? ctx.db.select({ name: users.displayName }).from(users).where(eq(users.id, d.row.finalizedBy)).get() : undefined
  return {
    match: d.detail,
    state: d.row.status === 'finished' ? 'final' : 'provisional',
    demo: ctx.mode === 'demo',
    organisationName: settings.organisationName,
    headerTitle: settings.reports.headerTitle,
    footerNote: settings.reports.footerNote,
    showLogos: settings.reports.showLogos,
    includeStatistics: settings.reports.includeStatistics,
    includeTimeline: settings.reports.includeTimeline,
    decidedBy: d.row.decidedBy,
    spectators: d.row.spectators,
    finalizedAt: d.row.finalizedAt,
    finalizedBy: finalizer?.name ?? null,
    home: reportSide(d, 'home', tallies, played),
    away: reportSide(d, 'away', tallies, played),
    periods: goalsByPeriod(d.events, d.plan),
    flow,
    biggestLead: biggestLead(flow),
    timeline: ordered.filter((e) => e.status === 'active').map((e) => reportEvent(e, d)),
    corrections: corrections(ctx, d, ordered),
    ledger: { digest: ledgerDigest(d.events), events: d.events.length, voided: d.events.filter((e) => e.status === 'voided').length }
  }
}
