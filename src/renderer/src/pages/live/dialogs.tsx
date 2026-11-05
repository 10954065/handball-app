import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { formatMatchTime, type PeriodDef } from '@shared/domain/periods'
import type { LiveClockDTO, LivePlayerDTO, LiveSideDTO } from '@shared/dto'
import { contrastOn } from '@/components/domain/identity'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Segmented } from '@/components/ui/table'
import { fmtTime } from '@/lib/format'
import { parseMatchTime } from '@/lib/live'

interface SetClockProps {
  currentMs: number
  period: PeriodDef
  busy: boolean
  onSubmit: (ms: number, reason: string) => void
  onClose: () => void
}

export function SetClockDialog({ currentMs, period, busy, onSubmit, onClose }: SetClockProps) {
  const [time, setTime] = useState(formatMatchTime(currentMs))
  const [reason, setReason] = useState('')
  const ms = parseMatchTime(time)
  const outside = ms !== null && (ms < period.startMs || ms > period.endMs)
  const valid = ms !== null && !outside && reason.trim().length >= 3
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Correct the match clock"
      description={`${period.label}: ${formatMatchTime(period.startMs)} - ${formatMatchTime(period.endMs)}. The correction is recorded with your reason.`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} loading={busy} onClick={() => onSubmit(ms!, reason.trim())}>Set clock</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Match time (MM:SS)" htmlFor="clock-time" error={ms === null ? 'Use the format MM:SS, e.g. 23:41.' : outside ? 'The time is outside this period.' : null}>
          <Input id="clock-time" value={time} onChange={(e) => setTime(e.target.value)} className="font-mono text-lg tabular" autoFocus />
        </Field>
        <Field label="Reason" htmlFor="clock-reason" required>
          <Input id="clock-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Clock started late after time-out" />
        </Field>
      </div>
    </Dialog>
  )
}

interface RecoveryProps {
  clock: LiveClockDTO
  period: PeriodDef | null
  busy: boolean
  onResume: (ms: number) => void
}

/** Shown after HMMS closed unexpectedly while the clock was running. It cannot be dismissed. */
export function RecoveryDialog({ clock, period, busy, onResume }: RecoveryProps) {
  const r = clock.recovery!
  const end = period?.endMs ?? Number.MAX_SAFE_INTEGER
  const withElapsed = Math.min(end, r.checkpointMs + (r.wallElapsedMs ?? 0))
  const [manual, setManual] = useState(formatMatchTime(r.checkpointMs))
  const manualMs = parseMatchTime(manual)
  return (
    <Dialog open onOpenChange={() => undefined} title="Recover the match clock" size="md">
      <div className="space-y-4 text-sm">
        <div className="flex gap-3 rounded-md border border-warning/40 bg-warning/10 p-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
          <p className="leading-relaxed">
            HMMS was closed unexpectedly while the clock was running in the {period?.label.toLowerCase() ?? 'match'}. All recorded events are safe. The last saved
            match time was <b className="font-mono">{formatMatchTime(r.checkpointMs)}</b>
            {r.checkpointWall ? ` at ${fmtTime(r.checkpointWall)}` : ''}. Agree the correct time with the timekeeper before continuing. The clock stays stopped.
          </p>
        </div>
        <div className="grid gap-2">
          <Button variant="secondary" className="justify-between" disabled={busy} onClick={() => onResume(r.checkpointMs)}>
            Continue from the last saved time <span className="font-mono">{formatMatchTime(r.checkpointMs)}</span>
          </Button>
          {r.wallElapsedMs !== null && (
            <Button variant="secondary" className="justify-between" disabled={busy} onClick={() => onResume(withElapsed)}>
              Add the real time that has passed ({Math.round(r.wallElapsedMs / 1000)} s) <span className="font-mono">{formatMatchTime(withElapsed)}</span>
            </Button>
          )}
          <div className="flex items-end gap-2">
            <Field label="Another time (MM:SS)" htmlFor="recover-time" className="flex-1">
              <Input id="recover-time" value={manual} onChange={(e) => setManual(e.target.value)} className="font-mono tabular" />
            </Field>
            <Button disabled={manualMs === null || busy} onClick={() => onResume(manualMs!)}>Use this time</Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

interface PickPlayerProps {
  title: string
  description: string
  team: LiveSideDTO
  players: LivePlayerDTO[]
  onPick: (p: LivePlayerDTO | null) => void
  onClose: () => void
  noneLabel?: string
}

/** Pick a player from a short list of large jersey tiles (substitution, assist). */
export function PickPlayerDialog({ title, description, team, players, onPick, onClose, noneLabel }: PickPlayerProps) {
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      size="md"
      footer={noneLabel ? <Button variant="secondary" onClick={() => onPick(null)} autoFocus>{noneLabel}</Button> : undefined}
    >
      {players.length === 0 ? (
        <p className="text-sm text-muted">No player is available.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {players.map((p) => (
            <button
              key={p.rosterId}
              onClick={() => onPick(p)}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-2 text-left hover:border-primary hover:bg-surface-hover"
            >
              <span className="grid h-11 min-w-11 place-items-center rounded-md font-display text-2xl font-bold tabular" style={{ background: team.color, color: contrastOn(team.color) }}>
                {p.jerseyNumber}
              </span>
              <span className="min-w-0 truncate text-[13px] font-semibold">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  )
}

interface VoidProps {
  title: string
  summary: string
  busy: boolean
  onSubmit: (reason: string) => void
  onClose: () => void
}

export function VoidDialog({ title, summary, busy, onSubmit, onClose }: VoidProps) {
  const [reason, setReason] = useState('Entered in error')
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description="The event stays in the ledger, marked as voided, with your name and reason."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={reason.trim().length < 3} loading={busy} onClick={() => onSubmit(reason.trim())} autoFocus>
            Void event
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm font-medium">{summary}</p>
        <Field label="Reason" htmlFor="void-reason" required>
          <Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}

type SanctionKind = 'warning' | 'suspension' | 'disqualification'

interface SanctionProps {
  title: string
  description: string
  /** Offered choices; a red card for a player has only one. */
  kinds: SanctionKind[]
  busy: boolean
  onSubmit: (kind: SanctionKind, blueCard: boolean, reason: string | undefined) => void
  onClose: () => void
}

const KIND_LABEL: Record<SanctionKind, string> = { warning: 'Warning', suspension: '2 minutes', disqualification: 'Red card' }

/** Red cards and sanctions for team officials: heavier decisions that deserve a second look. */
export function SanctionDialog({ title, description, kinds, busy, onSubmit, onClose }: SanctionProps) {
  const [kind, setKind] = useState<SanctionKind>(kinds[0])
  const [blueCard, setBlueCard] = useState(false)
  const [reason, setReason] = useState('')
  const red = kind === 'disqualification'
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={red ? 'danger' : 'primary'} loading={busy} onClick={() => onSubmit(kind, red && blueCard, reason.trim() || undefined)}>
            Record {KIND_LABEL[kind].toLowerCase()}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {kinds.length > 1 && <Segmented value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />}
        {red && <Switch label="Blue card" description="A written report to the disciplinary body is required." checked={blueCard} onCheckedChange={setBlueCard} />}
        <Field label="Reason (optional)" htmlFor="sanction-reason">
          <Input id="sanction-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}
