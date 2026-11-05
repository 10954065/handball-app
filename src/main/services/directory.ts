import { and, asc, eq, like, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { OfficialDTO, VenueDTO } from '@shared/dto'
import type { officialInputSchema, officialUpdateSchema, venueInputSchema, venueUpdateSchema } from '@shared/schemas/entities'
import { officials, venues } from '../db/schema'
import { audit } from './audit'
import { type Ctx, notFound, nowOf, tx, uuid } from './ctx'

const matchCount = sql<number>`(SELECT count(*) FROM match_officials mo WHERE mo.official_id = "officials"."id")`

export function listOfficials(ctx: Ctx, q?: { search?: string; includeArchived?: boolean }): OfficialDTO[] {
  const s = q?.search?.trim()
  return ctx.db
    .select({ o: officials, n: matchCount })
    .from(officials)
    .where(
      and(
        q?.includeArchived ? undefined : eq(officials.archived, false),
        s ? or(like(officials.fullName, `%${s}%`), like(officials.licenseNo, `%${s}%`), like(officials.region, `%${s}%`)) : undefined
      )
    )
    .orderBy(asc(officials.fullName))
    .all()
    .map(({ o, n }) => ({
      id: o.id,
      fullName: o.fullName,
      role: o.role,
      licenseNo: o.licenseNo,
      region: o.region,
      phone: o.phone,
      email: o.email,
      notes: o.notes,
      archived: o.archived,
      matchCount: Number(n)
    }))
}

const getOfficial = (ctx: Ctx, id: string) => listOfficials(ctx, { includeArchived: true }).find((o) => o.id === id) ?? notFound('Official')

export function createOfficial(ctx: Ctx, input: z.output<typeof officialInputSchema>): OfficialDTO {
  const id = uuid()
  tx(ctx, () => {
    ctx.db.insert(officials).values({ ...input, email: input.email || null, id, createdAt: nowOf(ctx), updatedAt: nowOf(ctx) }).run()
    audit(ctx, { action: 'officials.create', entity: 'officials', entityId: id, after: input })
  })
  return getOfficial(ctx, id)
}

export function updateOfficial(ctx: Ctx, input: z.output<typeof officialUpdateSchema>): OfficialDTO {
  const before = getOfficial(ctx, input.id)
  const { id, ...values } = input
  tx(ctx, () => {
    ctx.db.update(officials).set({ ...values, email: values.email || null, updatedAt: nowOf(ctx) }).where(eq(officials.id, id)).run()
    audit(ctx, { action: 'officials.update', entity: 'officials', entityId: id, before, after: values })
  })
  return getOfficial(ctx, id)
}

export function setOfficialArchived(ctx: Ctx, id: string, archived: boolean): OfficialDTO {
  getOfficial(ctx, id)
  tx(ctx, () => {
    ctx.db.update(officials).set({ archived, updatedAt: nowOf(ctx) }).where(eq(officials.id, id)).run()
    audit(ctx, { action: archived ? 'officials.archive' : 'officials.restore', entity: 'officials', entityId: id })
  })
  return getOfficial(ctx, id)
}

export function listVenues(ctx: Ctx, q?: { search?: string; includeArchived?: boolean }): VenueDTO[] {
  const s = q?.search?.trim()
  return ctx.db
    .select()
    .from(venues)
    .where(and(q?.includeArchived ? undefined : eq(venues.archived, false), s ? or(like(venues.name, `%${s}%`), like(venues.city, `%${s}%`)) : undefined))
    .orderBy(asc(venues.name))
    .all()
    .map((v) => ({ id: v.id, name: v.name, city: v.city, address: v.address, capacity: v.capacity, notes: v.notes, archived: v.archived }))
}

const getVenue = (ctx: Ctx, id: string) => listVenues(ctx, { includeArchived: true }).find((v) => v.id === id) ?? notFound('Venue')

export function createVenue(ctx: Ctx, input: z.output<typeof venueInputSchema>): VenueDTO {
  const id = uuid()
  tx(ctx, () => {
    ctx.db.insert(venues).values({ ...input, id, createdAt: nowOf(ctx), updatedAt: nowOf(ctx) }).run()
    audit(ctx, { action: 'venues.create', entity: 'venues', entityId: id, after: input })
  })
  return getVenue(ctx, id)
}

export function updateVenue(ctx: Ctx, input: z.output<typeof venueUpdateSchema>): VenueDTO {
  const before = getVenue(ctx, input.id)
  const { id, ...values } = input
  tx(ctx, () => {
    ctx.db.update(venues).set({ ...values, updatedAt: nowOf(ctx) }).where(eq(venues.id, id)).run()
    audit(ctx, { action: 'venues.update', entity: 'venues', entityId: id, before, after: values })
  })
  return getVenue(ctx, id)
}

export function setVenueArchived(ctx: Ctx, id: string, archived: boolean): VenueDTO {
  getVenue(ctx, id)
  tx(ctx, () => {
    ctx.db.update(venues).set({ archived, updatedAt: nowOf(ctx) }).where(eq(venues.id, id)).run()
    audit(ctx, { action: archived ? 'venues.archive' : 'venues.restore', entity: 'venues', entityId: id })
  })
  return getVenue(ctx, id)
}
