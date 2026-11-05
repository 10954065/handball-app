import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { ROLE_PERMISSIONS } from '@shared/domain/constants'
import { AppError, type IpcResult } from '@shared/errors'
import { contract, type ChannelName } from '@shared/ipc/contract'
import type { AppContext } from '../context'
import { log } from '../logger'
import type { HandlerMap, RequestContext } from './types'

/** Only pages served by this application may call the API. */
function isTrustedSender(event: IpcMainInvokeEvent, allowedOrigins: string[]): boolean {
  const url = event.senderFrame?.url ?? ''
  return allowedOrigins.some((o) => url.startsWith(o))
}

function authorize(app: AppContext, perm: (typeof contract)[ChannelName]['perm']): void {
  if (perm === 'public') return
  const user = app.session
  if (!user) throw new AppError('UNAUTHENTICATED', 'Please sign in.')
  if (!ROLE_PERMISSIONS[user.role].includes(perm)) {
    throw new AppError('FORBIDDEN', 'Your account does not have permission for this action.')
  }
}

export function registerIpc(app: AppContext, handlers: HandlerMap, allowedOrigins: string[]): void {
  for (const name of Object.keys(contract) as ChannelName[]) {
    const def = contract[name]
    ipcMain.handle(`hmms:${name}`, async (event, raw): Promise<IpcResult<unknown>> => {
      try {
        if (!isTrustedSender(event, allowedOrigins)) throw new AppError('FORBIDDEN', 'Untrusted caller.')
        const parsed = def.input.safeParse(raw)
        if (!parsed.success) {
          throw new AppError(
            'VALIDATION',
            'Some fields are invalid.',
            parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
          )
        }
        authorize(app, def.perm)
        const ctx: RequestContext = { app, sender: event.sender, db: app.db, sqlite: app.sqlite, user: app.session, mode: app.mode }
        const handler = handlers[name] as (input: unknown, ctx: RequestContext) => unknown
        const data = await handler(parsed.data, ctx)
        return { ok: true, data }
      } catch (err) {
        if (err instanceof AppError) return { ok: false, error: err.toJSON() }
        const sqliteCode = (err as { code?: string }).code
        if (sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE') {
          return { ok: false, error: { code: 'CONFLICT', message: 'This record conflicts with an existing one.' } }
        }
        log.error(`IPC ${name} failed`, err)
        return { ok: false, error: { code: 'INTERNAL', message: 'An unexpected error occurred. Details were written to the log.' } }
      }
    })
  }
}
