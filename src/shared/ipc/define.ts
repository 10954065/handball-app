import type { z } from 'zod'
import type { Permission } from '../domain/constants'

/** A typed IPC channel: input schema (validated in the main process), permission, output type. */
export interface ChannelDef<I extends z.ZodType, O> {
  perm: Permission
  input: I
  /** Phantom field carrying the output type. Never set at runtime. */
  readonly __out?: O
}

export const channel =
  <O>() =>
  <I extends z.ZodType>(perm: Permission, input: I): ChannelDef<I, O> => ({ perm, input })
