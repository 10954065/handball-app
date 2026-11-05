import { useState } from 'react'
import { SHOT_OUTCOME_LABELS, SHOT_OUTCOMES, SHOT_SITUATION_LABELS, SHOT_SITUATIONS, SHOT_ZONE_LABELS, SHOT_ZONES, type Side } from '@shared/domain/constants'
import type { EventDraft } from '@shared/domain/live'
import { formatMatchTime } from '@shared/domain/periods'
import type { LiveEventDTO, LiveMatchDTO } from '@shared/dto'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { parseMatchTime } from '@/lib/live'
import { PLAYS } from './action-parts'

type Kind = 'shot' | (typeof PLAYS)[number]['kind']

interface EditEventProps {
  live: LiveMatchDTO
  event: LiveEventDTO
  busy: boolean
  onSubmit: (draft: EventDraft, matchMs: number | undefined, reason: string) => void
  onClose: () => void
}

/** Correct an event. The original is kept (voided) and the corrected copy takes its place. */
export function EditEventDialog({ live, event, busy, onSubmit, onClose }: EditEventProps) {
  const shootout = event.situation === 'shootout'
  const [kind, setKind] = useState<Kind>(event.type as Kind)
  const [side, setSide] = useState<Side>(event.side ?? 'home')
  const [rosterId, setRosterId] = useState(event.player?.rosterId ?? '')
  const [outcome, setOutcome] = useState(event.outcome ?? 'goal')
  const [situation, setSituation] = useState(event.situation ?? 'positional')
  const [zone, setZone] = useState(event.zone ?? '')
  const [assist, setAssist] = useState(event.assist?.rosterId ?? '')
  const [time, setTime] = useState(formatMatchTime(event.matchMs))
  const [reason, setReason] = useState('')
  const players = live[side].players
  const ms = parseMatchTime(time)

  const draft = (): EventDraft =>
    kind === 'shot'
      ? { kind, side, rosterId, outcome, situation, zone: zone ? (zone as (typeof SHOT_ZONES)[number]) : null, assistRosterId: assist || null }
      : { kind, side, rosterId: rosterId || null }
  const valid = (kind !== 'shot' || !!rosterId) && reason.trim().length >= 3 && (shootout || ms !== null)
  const changeSide = (s: Side) => {
    setSide(s)
    setRosterId('')
    setAssist('')
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Correct event"
      description="The original entry stays in the ledger, marked as corrected."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} loading={busy} onClick={() => onSubmit(draft(), shootout || ms === event.matchMs ? undefined : ms!, reason.trim())}>
            Save correction
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Event" htmlFor="ev-kind">
          <Select id="ev-kind" value={kind} disabled={shootout} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="shot">Shot</option>
            {PLAYS.map((p) => (
              <option key={p.kind} value={p.kind}>{p.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Team" htmlFor="ev-side">
          <Select id="ev-side" value={side} onChange={(e) => changeSide(e.target.value as Side)}>
            <option value="home">{live.home.name}</option>
            <option value="away">{live.away.name}</option>
          </Select>
        </Field>
        <Field label="Player" htmlFor="ev-player" required={kind === 'shot'}>
          <Select id="ev-player" value={rosterId} onChange={(e) => setRosterId(e.target.value)}>
            <option value="">{kind === 'shot' ? 'Choose a player' : 'Team (no player)'}</option>
            {players.map((p) => (
              <option key={p.rosterId} value={p.rosterId}>#{p.jerseyNumber} {p.name}</option>
            ))}
          </Select>
        </Field>
        {!shootout && (
          <Field label="Match time (MM:SS)" htmlFor="ev-time" error={ms === null ? 'Use MM:SS.' : null}>
            <Input id="ev-time" value={time} onChange={(e) => setTime(e.target.value)} className="font-mono tabular" />
          </Field>
        )}
        {kind === 'shot' && (
          <>
            <Field label="Outcome" htmlFor="ev-outcome">
              <Select id="ev-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
                {SHOT_OUTCOMES.map((o) => (
                  <option key={o} value={o}>{SHOT_OUTCOME_LABELS[o]}</option>
                ))}
              </Select>
            </Field>
            {!shootout && (
              <>
                <Field label="Situation" htmlFor="ev-situation">
                  <Select id="ev-situation" value={situation} onChange={(e) => setSituation(e.target.value as typeof situation)}>
                    {SHOT_SITUATIONS.filter((s) => s !== 'shootout').map((s) => (
                      <option key={s} value={s}>{SHOT_SITUATION_LABELS[s]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Zone" htmlFor="ev-zone">
                  <Select id="ev-zone" value={zone} onChange={(e) => setZone(e.target.value)}>
                    <option value="">Not recorded</option>
                    {SHOT_ZONES.map((z) => (
                      <option key={z} value={z}>{SHOT_ZONE_LABELS[z]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Assist" htmlFor="ev-assist">
                  <Select id="ev-assist" value={assist} onChange={(e) => setAssist(e.target.value)} disabled={outcome !== 'goal'}>
                    <option value="">No assist</option>
                    {players.filter((p) => p.rosterId !== rosterId).map((p) => (
                      <option key={p.rosterId} value={p.rosterId}>#{p.jerseyNumber} {p.name}</option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
          </>
        )}
        <Field label="Reason for the correction" htmlFor="ev-reason" required className="col-span-2">
          <Input id="ev-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Scorer confirmed by the referees" />
        </Field>
      </div>
    </Dialog>
  )
}
