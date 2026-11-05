import { useEffect, useRef } from 'react'
import type { AppSettings, LiveEventDTO, LiveMatchDTO, LivePlayerDTO } from '@shared/dto'
import { playHorn } from '@/lib/live'
import type { Selection } from './action-panel'
import { PickPlayerDialog, SetClockDialog, VoidDialog } from './dialogs'
import { EditEventDialog } from './edit-event'
import { eventTitle } from './labels'
import type { useLiveActions } from './use-live-actions'

export type Modal =
  | { kind: 'clock' }
  | { kind: 'sub' }
  | { kind: 'assist'; scorer: Selection }
  | { kind: 'edit'; event: LiveEventDTO }
  | { kind: 'void'; event: LiveEventDTO }
  | null

export const eventSummary = (e: LiveEventDTO, live: LiveMatchDTO) =>
  `${eventTitle(e, live)}${e.player ? ` - #${e.player.jerseyNumber} ${e.player.name}` : ''}${e.side ? ` (${live[e.side].code})` : ''}`

/** Sound the horn when the clock stops at the end of a period (if enabled in settings). */
export function usePeriodHorn(live: LiveMatchDTO, sound: AppSettings['sound'] | undefined) {
  const wasRunning = useRef(live.clock.running)
  useEffect(() => {
    const atEnd = !!live.period && live.period.kind !== 'shootout' && live.clock.elapsedMs >= live.period.endMs
    if (wasRunning.current && !live.clock.running && atEnd && sound?.enabled && sound.periodEnd) playHorn(sound.volume)
    wasRunning.current = live.clock.running
  }, [live.clock.running, live.clock.elapsedMs, live.period, sound])
}

interface ModalsProps {
  live: LiveMatchDTO
  modal: Modal
  setModal: (m: Modal) => void
  act: ReturnType<typeof useLiveActions>
  selection: Selection | null
  displayMs: number
  trackCourt: boolean
  onSubstitute: (p: LivePlayerDTO) => void
  onAssist: (scorer: Selection, assistRosterId: string | null) => void
}

export function LiveModals({ live, modal, setModal, act, selection, displayMs, trackCourt, onSubstitute, onAssist }: ModalsProps) {
  const close = () => setModal(null)
  const run = async (p: Promise<unknown>) => {
    try {
      await p
      close()
    } catch (err) {
      act.fail(err)
    }
  }
  if (!modal) return null
  if (modal.kind === 'clock' && live.period) {
    return <SetClockDialog currentMs={displayMs} period={live.period} busy={act.busy} onClose={close} onSubmit={(ms, reason) => void run(act.setClock(ms, reason))} />
  }
  if (modal.kind === 'sub' && selection) {
    const team = live[selection.side]
    const off = selection.player.status === 'court'
    return (
      <PickPlayerDialog
        title={off ? `Substitute #${selection.player.jerseyNumber} ${selection.player.name}` : `Bring on #${selection.player.jerseyNumber} ${selection.player.name}`}
        description={off ? 'Choose the player coming on.' : 'Choose the player going off.'}
        team={team}
        players={team.players.filter((p) => p.status === (off ? 'bench' : 'court'))}
        onPick={(p) => p && onSubstitute(p)}
        onClose={close}
      />
    )
  }
  if (modal.kind === 'assist') {
    const team = live[modal.scorer.side]
    const mates = team.players.filter((p) => p.rosterId !== modal.scorer.player.rosterId && p.status !== 'disqualified' && (!trackCourt || p.status === 'court'))
    return (
      <PickPlayerDialog
        title={`Goal #${modal.scorer.player.jerseyNumber} ${modal.scorer.player.name} - assist?`}
        description="Choose the player who gave the assist."
        team={team}
        players={mates}
        noneLabel="No assist (Enter)"
        onPick={(p) => {
          close()
          onAssist(modal.scorer, p?.rosterId ?? null)
        }}
        onClose={close}
      />
    )
  }
  if (modal.kind === 'edit') {
    return <EditEventDialog live={live} event={modal.event} busy={act.busy} onClose={close} onSubmit={(d, ms, reason) => void run(act.edit(modal.event.id, d, ms, reason))} />
  }
  if (modal.kind === 'void') {
    return <VoidDialog title="Void event" summary={eventSummary(modal.event, live)} busy={act.busy} onClose={close} onSubmit={(reason) => void run(act.voidEvent(modal.event.id, reason))} />
  }
  return null
}
