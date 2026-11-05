import type { AppErrorShape, ErrorCode, IpcResult } from '@shared/errors'
import type { ChannelInput, ChannelName, ChannelOutput, PushEventName, PushEvents } from '@shared/ipc/contract'

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly details?: string[]
  constructor(shape: AppErrorShape) {
    super(shape.message)
    this.code = shape.code
    this.details = shape.details
  }
}

type Args<K extends ChannelName> = undefined extends ChannelInput<K> ? [input?: ChannelInput<K>] : [input: ChannelInput<K>]

/** Call a main-process channel. Resolves with data or throws ApiError. */
export async function call<K extends ChannelName>(channel: K, ...args: Args<K>): Promise<ChannelOutput<K>> {
  const res = (await window.hmms.invoke(channel, args[0])) as IpcResult<ChannelOutput<K>>
  if (!res || typeof res !== 'object') throw new ApiError({ code: 'INTERNAL', message: 'No response from the application.' })
  if (!res.ok) throw new ApiError(res.error)
  return res.data
}

export function subscribe<K extends PushEventName>(event: K, listener: (payload: PushEvents[K]) => void): () => void {
  return window.hmms.on(event, listener as (p: unknown) => void)
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.details?.length ? `${err.message} ${err.details.join(' ')}` : err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}
