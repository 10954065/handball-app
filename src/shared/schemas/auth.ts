import { z } from 'zod'
import { ROLES } from '../domain/constants'

const username = z
  .string()
  .trim()
  .min(3, 'At least 3 characters')
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dot, dash and underscore only')

const password = z.string().min(8, 'At least 8 characters').max(128)

export const setupSchema = z.object({
  username,
  displayName: z.string().trim().min(1).max(80),
  password,
  organisationName: z.string().trim().max(120).optional()
})

export const loginSchema = z.object({ username: z.string().trim().min(1).max(32), password: z.string().min(1).max(128) })

export const changePasswordSchema = z.object({ current: z.string().min(1).max(128), next: password })

export const createUserSchema = z.object({
  username,
  displayName: z.string().trim().min(1).max(80),
  role: z.enum(ROLES),
  password
})

export const updateUserSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().trim().min(1).max(80).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  password: password.optional()
})
