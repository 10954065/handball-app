import { toast } from 'sonner'
import type { Side } from '@shared/domain/constants'
import type { EventDraft } from '@shared/domain/live'
import type { LiveEventDTO, LiveMatchDTO } from '@shared/dto'
import type { ChannelInput } from '@shared/ipc/contract'
import { useConfirm } from '@/components/ui/confirm'
import { ApiError, errorMessage } from '@/lib/api'
import { useSetLive } from '@/lib/live'
import { useApiMutation } from '@/lib/query'
import { eventTitle } from './labels'
import type { NoticeInput } from './notices'

const NO_TOAST = { toastError: false } as const

export type SanctionInput = Omit<ChannelInput<'live.sanction'>, 'matchId' | 'clientRequestId' | 'acknowledged'>

export function eventSummary(e: LiveEventDTO, live: LiveMatchDTO): string {
  const who = e.player ? ` - #${e.player.jerseyNumber} ${e.player.name}` : e.official ? ` - Official ${e.official.slot} ${e.official.name}` : ''
  return `${eventTitle(e, live)}${who}${e.side ? ` (${live[e.side].code})` : ''}`
}

/** All operator actions of the match centre, with confirmations where the rules or settings ask for them. */
export function useLiveActions(matchId: string, confirmCritical: boolean, notify: (n: NoticeInput) => void) {
  const setLive = useSetLive(matchId)
  const confirm = useConfirm()
  const opts = { ...NO_TOAST, onSuccess: setLive }
  const m = {
    record: useApiMutation('live.record', opts),
    start: useApiMutation('live.startPeriod', opts),
    clock: useApiMutation('live.clock', opts),
    setClock: useApiMutation('live.setClock', opts),
    recover: useApiMutation('live.recoverClock', opts),
    end: useApiMutation('live.endPeriod', opts),
    finish: useApiMutation('live.finish', opts),
    edit: useApiMutation('live.edit', opts),
    void: useApiMutation('live.void', opts),
    sanction: useApiMutation('live.sanction', { ...NO_TOAST, onSuccess: (d) => setLive(d.live) }),
    timeoutStart: useApiMutation('live.timeoutStart', opts),
    timeoutEnd: useApiMutation('live.timeoutEnd', opts),
    scoreboard: useApiMutation('live.openScoreboard', NO_TOAST)
  }
  const busy = Object.values(m).some((x) => x.isPending)
  const fail = (err: unknown) => notify({ tone: 'error', text: errorMessage(err) })
  /** A message over an open dialog: the notice area is behind it, and no tile can be covered. */
  const failInDialog = (err: unknown) => toast.error(errorMessage(err))

  /** Run a call; if the main process asks for confirmation, ask the operator and retry with force. */
  async function withForce(run: (force: boolean) => Promise<unknown>, confirmLabel = 'Yes, continue') {
    try {
      await run(false)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NEEDS_CONFIRMATION') {
        const ok = await confirm({ title: err.message, items: err.details, confirmLabel, tone: 'danger' })
        if (ok) await run(true).catch(fail)
      } else fail(err)
    }
  }

  return {
    m,
    busy,
    record: (event: EventDraft) => m.record.mutateAsync({ matchId, clientRequestId: crypto.randomUUID(), event }),
    startPeriod: async (label: string, first: boolean) => {
      if (confirmCritical || first) {
        const ok = await confirm({
          title: first ? 'Start the match?' : `Start the ${label.toLowerCase()}?`,
          message: first ? 'The match sheets are locked once the match starts. The clock starts when you press Start clock at the throw-off.' : 'The clock starts when you press Start clock at the throw-off.',
          confirmLabel: first ? 'Start match' : 'Start'
        })
        if (!ok) return
      }
      await m.start.mutateAsync({ matchId }).catch(fail)
    },
    toggleClock: (running: boolean) => m.clock.mutateAsync({ matchId, action: running ? 'stop' : 'start' }).catch(fail),
    setClock: (ms: number, reason: string) => m.setClock.mutateAsync({ matchId, ms, reason }),
    recover: (resumeAtMs: number) => m.recover.mutateAsync({ matchId, resumeAtMs }).catch(fail),
    endPeriod: async (label: string) => {
      if (confirmCritical && !(await confirm({ title: `End the ${label.toLowerCase()}?`, confirmLabel: 'End period' }))) return
      await withForce((force) => m.end.mutateAsync({ matchId, force }))
    },
    finish: async () => {
      const ok = await confirm({
        title: 'Finish and finalize the match?',
        message: 'The result is written from the event ledger. Afterwards only an administrator can correct the match, and every correction is audited.',
        confirmLabel: 'Finalize match'
      })
      if (ok) await withForce((force) => m.finish.mutateAsync({ matchId, force }))
    },
    edit: (eventId: string, event: EventDraft, matchMs: number | undefined, reason: string) => m.edit.mutateAsync({ matchId, eventId, event, matchMs, reason }),
    voidEvent: (eventId: string, reason: string) => m.void.mutateAsync({ matchId, eventId, reason }),
    /** The referees decide: a rule conflict is shown once, then the decision is recorded. */
    sanction: async (input: SanctionInput) => {
      const clientRequestId = crypto.randomUUID()
      await withForce(async (acknowledged) => {
        const { live, notes } = await m.sanction.mutateAsync({ ...input, matchId, clientRequestId, acknowledged })
        const e = live.events.find((x) => x.type === input.kind) ?? live.events[0]
        notify({ tone: 'success', text: eventSummary(e, live) })
        for (const note of notes) notify({ tone: 'info', text: note })
      }, 'Record the decision')
    },
    timeoutStart: (side: Side) => m.timeoutStart.mutateAsync({ matchId, clientRequestId: crypto.randomUUID(), side }).catch(fail),
    timeoutEnd: () => m.timeoutEnd.mutateAsync({ matchId }).catch(fail),
    openScoreboard: () => m.scoreboard.mutateAsync({ matchId }).catch(fail),
    fail,
    failInDialog
  }
}
