import { z } from 'zod'

const id = z.string().uuid()

export const statisticsQuery = z.object({ seasonId: id.optional(), competitionId: id.optional(), teamId: id.optional() })

export const reportFormat = z.enum(['pdf', 'xlsx'])
export const generateReportSchema = z.object({ matchId: id, format: reportFormat })
export const reportListQuery = z.object({ matchId: id.optional(), limit: z.number().int().min(1).max(500).default(200) })
