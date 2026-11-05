import type { Side } from '@shared/domain/constants'
import type { LiveEventDTO, LiveMatchDTO, LiveOfficialDTO, LivePlayerDTO } from '@shared/dto'
import type { Selection } from './action-panel'
import { PickPlayerDialog, SanctionDialog, SetClockDialog, VoidDialog } from './dialogs'
import { EditEventDialog } from './edit-event'
import { eventSummary, type useLiveActions } from './use-live-actions'

export type Modal =
  | { kind: 'clock' }
  | { kind: 'sub' }
  | { kind: 'assist'; scorer: Selection }
  | { kind: 'edit'; event: LiveEventDTO }
  | { kind: 'void'; event: LiveEventDTO }
  | { kind: 'red'; side: Side; player: LivePlayerDTO }
  | { kind: 'official'; side: Side; official: LiveOfficialDTO }
  | null

interface ModalsProps {
  live: LiveMatchDTO
  modal: Modal
  setModal: (m: Modal) => void
  act: ReturnType<typeof useLiveActions>
  selection: Selection | null
  displayMs: number
  trackCourt: boolean
  onSubstitute: (p: LivePlayerDTO | null) => void
  onSanctioned: () => void
  onAssist: (scorer: Selection, assistRosterId: string | null) => void
}

export function LiveModals({ live, modal, setModal, act, selection, displayMs, trackCourt, onSubstitute, onSanctioned, onAssist }: ModalsProps) {
  const close = () => setModal(null)
  const run = async (p: Promise<unknown>) => {
    try {
      await p
      close()
    } catch (err) {
      act.failInDialog(err)
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
        noneLabel={off ? 'Nobody comes on' : team.onCourt < team.allowedOnCourt ? 'Nobody goes off' : undefined}
        onPick={onSubstitute}
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
  if (modal.kind === 'red') {
    const { side, player } = modal
    return (
      <SanctionDialog
        title={`Red card - #${player.jerseyNumber} ${player.name}`}
        description="Disqualification for the rest of the match."
        kinds={['disqualification']}
        busy={act.busy}
        onClose={close}
        onSubmit={(kind, blueCard, reason) => {
          close()
          void act.sanction({ kind, side, target: { type: 'player', rosterId: player.rosterId }, blueCard, reason }).then(onSanctioned)
        }}
      />
    )
  }
  if (modal.kind === 'official') {
    const { side, official } = modal
    return (
      <SanctionDialog
        title={`Official ${official.slot} - ${official.name}`}
        description={`${official.role}. A suspension or disqualification reduces the team on court.`}
        kinds={['warning', 'suspension', 'disqualification']}
        busy={act.busy}
        onClose={close}
        onSubmit={(kind, blueCard, reason) => {
          close()
          void act.sanction({ kind, side, target: { type: 'official', teamOfficialId: official.id }, blueCard, reason })
        }}
      />
    )
  }
  if (modal.kind === 'void') {
    return <VoidDialog title="Void event" summary={eventSummary(modal.event, live)} busy={act.busy} onClose={close} onSubmit={(reason) => void run(act.voidEvent(modal.event.id, reason))} />
  }
  return null
}
