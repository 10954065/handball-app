import { z } from 'zod'

export const idSchema = z.string().uuid()
export const idInput = z.object({ id: idSchema })
export const noInput = z.undefined().or(z.object({}).strict()).optional()

/** Trimmed text with a max length; empty strings become null. */
export const optText = (max = 200) =>
  z
    .string()
    .max(max)
    .transform((s) => s.trim())
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional()

export const reqText = (max = 200) => z.string().trim().min(1, 'Required').max(max)

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB colour')

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .nullable()
  .optional()

export const listQuery = z
  .object({
    search: z.string().max(100).optional(),
    includeArchived: z.boolean().optional()
  })
  .optional()
