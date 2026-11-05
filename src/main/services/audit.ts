import { and, desc, eq } from 'drizzle-orm'
import type { AuditDTO } from '@shared/dto'
import { auditLogs } from '../db/schema'
import { type Ctx, nowOf, uuid } from './ctx'

export interface AuditEntry {
  action: string
  entity: string
  entityId?: string | null
  matchId?: string | null
  before?: unknown
  after?: unknown
  note?: string | null
}

/** Append an audit record. Call inside the same transaction as the change it describes. */
export function audit(ctx: Ctx, e: AuditEntry): void {
  ctx.db
    .insert(auditLogs)
    .values({
      id: uuid(),
      at: nowOf(ctx),
      userId: ctx.user?.id ?? null,
      username: ctx.user?.username ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      matchId: e.matchId ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
      note: e.note ?? null
    })
    .run()
}

export function listAudit(ctx: Ctx, q: { limit: number; offset: number; matchId?: string }): AuditDTO[] {
  const where = q.matchId ? and(eq(auditLogs.matchId, q.matchId)) : undefined
  return ctx.db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.at))
    .limit(q.limit)
    .offset(q.offset)
    .all()
    .map((r) => ({
      id: r.id,
      at: r.at,
      username: r.username,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      matchId: r.matchId,
      note: r.note,
      before: r.before,
      after: r.after
    }))
}
