import { ArrowLeftRight, X } from 'lucide-react'
import type { ShotOutcome, ShotSituation, ShotZone, Side } from '@shared/domain/constants'
import type { PlayKind } from '@shared/domain/live'
import type { LiveMatchDTO, LivePlayerDTO } from '@shared/dto'
import { contrastOn } from '@/components/domain/identity'
import { Button } from '@/components/ui/button'
import { Choice, IdlePanel, Key, MISSES, PLAYS, Row, SITUATIONS, ZONES } from './action-parts'

export interface EntryState {
  situation: ShotSituation
  zone: ShotZone | null
}

export interface Selection {
  side: Side
  player: LivePlayerDTO
}

interface ActionPanelProps {
  live: LiveMatchDTO
  selection: Selection | null
  entry: EntryState
  onEntry: (e: EntryState) => void
  onShot: (outcome: ShotOutcome) => void
  onPlay: (kind: PlayKind) => void
  onSubstitute: () => void
  onClear: () => void
  advanced: boolean
  trackCourt: boolean
  busy: boolean
  typed: { side: Side; digits: string } | null
}

/** What the selected player can do right now. Shared by the panel and the keyboard shortcuts. */
export function abilities(live: LiveMatchDTO, sel: Selection | null, trackCourt: boolean) {
  const inPeriod = live.clock.phase === 'in_period' && live.match.status === 'live'
  const shootout = live.period?.kind === 'shootout'
  const st = sel?.player.status
  return {
    inPeriod,
    shootout,
    shoot: !!sel && inPeriod && st !== 'disqualified' && st !== 'suspended',
    play: !!sel && inPeriod && !shootout && st !== 'disqualified',
    substitute:
      !!sel && trackCourt && !shootout && live.match.status === 'live' && (live.clock.phase === 'in_period' || live.clock.phase === 'break') && (st === 'court' || st === 'bench')
  }
}

/** Records events for the selected player: a goal is two clicks (tile, Goal) or two keys. */
export function ActionPanel(p: ActionPanelProps) {
  const { live, selection: sel } = p
  if (!sel) return <IdlePanel typed={p.typed} live={live} />
  const can = abilities(live, sel, p.trackCourt)
  const team = live[sel.side]
  const pl = sel.player
  const goalLabel = can.shootout ? 'Shoot-out goal' : p.entry.situation === 'seven_metre' ? '7 m goal' : 'Goal'

  return (
    <section aria-label="Record event" className="rounded-xl border border-primary/50 bg-surface-1">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="grid h-14 min-w-14 place-items-center rounded-lg px-1.5 font-display text-4xl font-bold tabular" style={{ background: team.color, color: contrastOn(team.color) }}>
          {pl.jerseyNumber}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{pl.name}</div>
          <div className="text-xs text-muted">
            {team.code} - {pl.status === 'court' ? 'on court' : pl.status} - {pl.goals} goals / {pl.shots} shots{pl.isGoalkeeper ? ` - ${pl.saves} saves` : ''}
          </div>
        </div>
        <button className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text" onClick={p.onClear} aria-label="Clear selection (Esc)" title="Clear selection (Esc)">
          <X className="size-4" />
        </button>
      </header>
      <div className="space-y-3 p-4">
        {!can.inPeriod && <p className="rounded-md bg-surface-2 px-3 py-2 text-[12.5px] text-muted">Shots and play events are recorded while a period is in progress.</p>}
        {can.inPeriod && !can.shootout && (
          <>
            <Choice label="Situation" value={p.entry.situation} options={SITUATIONS} onChange={(situation) => p.onEntry({ ...p.entry, situation })} />
            {p.entry.situation !== 'seven_metre' && (
              <Choice label="Zone (optional)" value={p.entry.zone} options={ZONES} onChange={(zone) => p.onEntry({ ...p.entry, zone: p.entry.zone === zone ? null : zone })} />
            )}
          </>
        )}
        <Button variant="success" size="xl" className="w-full" disabled={!can.shoot || p.busy} onClick={() => p.onShot('goal')}>
          {goalLabel} <Key k="G" />
        </Button>
        {(p.advanced || can.shootout) && (
          <Row>
            {MISSES.filter((m) => !can.shootout || m.outcome !== 'blocked').map((m) => (
              <Button key={m.outcome} variant="secondary" disabled={!can.shoot || p.busy} onClick={() => p.onShot(m.outcome)}>
                {m.label} <Key k={m.key} />
              </Button>
            ))}
          </Row>
        )}
        {p.advanced && !can.shootout && (
          <Row>
            {PLAYS.map((a) => (
              <Button key={a.kind} variant="outline" size="sm" disabled={!can.play || p.busy} onClick={() => p.onPlay(a.kind)}>
                {a.label} <Key k={a.key} />
              </Button>
            ))}
          </Row>
        )}
        {can.substitute && (
          <Button variant="subtle" className="w-full" disabled={p.busy} onClick={p.onSubstitute}>
            <ArrowLeftRight /> {pl.status === 'court' ? 'Substitute off' : 'Bring on'} <Key k="U" />
          </Button>
        )}
      </div>
    </section>
  )
}
