import { createHash } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { MatchReportDTO, ReportFileDTO, ReportFormat } from '@shared/dto'
import { matchReports, matches, users } from '../../db/schema'
import { audit } from '../audit'
import { type Ctx, notFound, nowOf, tx, uuid } from '../ctx'
import { currentLedgerDigest } from './data'

const TEMPLATE = 'match_report'

export const reportContentKey = (report: MatchReportDTO): string => createHash('sha256').update(JSON.stringify(report)).digest('hex')

/** A safe Windows file name: letters, digits, spaces, dots and hyphens only. */
export function reportFileName(report: MatchReportDTO, format: ReportFormat): string {
  const m = report.match
  const name = `${report.demo ? 'DEMO - ' : ''}${m.matchNumber} ${m.home.code} v ${m.away.code} ${report.state === 'final' ? 'match report' : 'provisional report'}`
  return `${name.replace(/[^\w.\- ]+/g, '_')}.${format}`
}

function listRows(ctx: Ctx, where: ReturnType<typeof and>, limit: number) {
  return ctx.db
    .select({
      id: matchReports.id,
      matchId: matchReports.matchId,
      format: matchReports.format,
      fileName: matchReports.fileName,
      matchState: matchReports.matchState,
      ledgerDigest: matchReports.ledgerDigest,
      createdAt: matchReports.createdAt,
      sizeBytes: sql<number>`length(${matchReports.bytes})`,
      generatedBy: users.displayName,
      matchNumber: matches.matchNumber,
      matchStatus: matches.status,
      home: matches.homeTeamName,
      away: matches.awayTeamName
    })
    .from(matchReports)
    .innerJoin(matches, eq(matches.id, matchReports.matchId))
    .leftJoin(users, eq(users.id, matchReports.generatedBy))
    .where(where)
    .orderBy(desc(matchReports.createdAt), desc(matchReports.id))
    .limit(limit)
    .all()
}

/**
 * Archived files, newest first. A file is outdated once the match has been corrected, or once the
 * match it calls provisional has been finalized: finishing a match adds nothing to the ledger.
 */
export function listReports(ctx: Ctx, q: { matchId?: string; limit: number }): ReportFileDTO[] {
  const rows = listRows(ctx, and(q.matchId ? eq(matchReports.matchId, q.matchId) : undefined), q.limit)
  const digests = new Map<string, string>()
  const digestOf = (matchId: string) => {
    if (!digests.has(matchId)) digests.set(matchId, currentLedgerDigest(ctx, matchId))
    return digests.get(matchId)
  }
  return rows.map((r) => ({
    id: r.id,
    matchId: r.matchId,
    matchNumber: r.matchNumber,
    title: `${r.home} v ${r.away}`,
    format: r.format,
    fileName: r.fileName,
    sizeBytes: r.sizeBytes,
    matchState: r.matchState,
    outdated: digestOf(r.matchId) !== r.ledgerDigest || (r.matchState === 'provisional' && r.matchStatus === 'finished'),
    generatedBy: r.generatedBy,
    createdAt: r.createdAt
  }))
}

/** The archived file for exactly this report content, if one exists. */
export function findArchived(ctx: Ctx, matchId: string, format: ReportFormat, contentKey: string): ReportFileDTO | null {
  const row = ctx.db
    .select({ id: matchReports.id })
    .from(matchReports)
    .where(and(eq(matchReports.matchId, matchId), eq(matchReports.format, format), eq(matchReports.contentKey, contentKey)))
    .get()
  return row ? (listReports(ctx, { matchId, limit: 500 }).find((r) => r.id === row.id) ?? null) : null
}

export function storeReport(ctx: Ctx, report: MatchReportDTO, format: ReportFormat, bytes: Buffer): ReportFileDTO {
  const id = uuid()
  const matchId = report.match.id
  const fileName = reportFileName(report, format)
  tx(ctx, () => {
    ctx.db
      .insert(matchReports)
      .values({
        id,
        matchId,
        format,
        template: TEMPLATE,
        fileName,
        bytes,
        matchState: report.state,
        ledgerDigest: report.ledger.digest,
        contentKey: reportContentKey(report),
        generatedBy: ctx.user?.id ?? null,
        createdAt: nowOf(ctx)
      })
      .run()
    audit(ctx, { action: 'report.generate', entity: 'match_reports', entityId: id, matchId, after: { format, fileName, ledgerDigest: report.ledger.digest } })
  })
  return listReports(ctx, { matchId, limit: 500 }).find((r) => r.id === id) ?? notFound('Report')
}

export function readReport(ctx: Ctx, id: string): { matchId: string; fileName: string; format: ReportFormat; bytes: Buffer } {
  const r = ctx.db.select().from(matchReports).where(eq(matchReports.id, id)).get() ?? notFound('Report')
  return { matchId: r.matchId, fileName: r.fileName, format: r.format, bytes: r.bytes }
}

export function auditReportExport(ctx: Ctx, report: { id: string; matchId: string; fileName: string }, path: string): void {
  audit(ctx, { action: 'report.export', entity: 'match_reports', entityId: report.id, matchId: report.matchId, after: { fileName: report.fileName, path } })
}
