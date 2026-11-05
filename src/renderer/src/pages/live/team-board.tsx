import { POSITION_SHORT } from '@shared/domain/constants'
import type { LivePlayerDTO, LiveSideDTO } from '@shared/dto'
import { contrastOn, PlayerAvatar, TeamCrest } from '@/components/domain/identity'
import { cn } from '@/lib/cn'

interface TeamBoardProps {
  team: LiveSideDTO
  selectedId: string | null
  onSelect: (p: LivePlayerDTO) => void
  /** When court presence is not tracked, all players are shown as one squad. */
  trackCourt: boolean
  disabled?: boolean
  armed?: boolean
}

const STATUS_LABEL = { court: 'On court', bench: 'Bench', suspended: '2 min', disqualified: 'Disqualified' } as const

/** One team: every player as a large tile, on-court players first. Click or type the jersey number. */
export function TeamBoard({ team, selectedId, onSelect, trackCourt, disabled, armed }: TeamBoardProps) {
  const groups = trackCourt
    ? [
        { title: 'On court', players: team.players.filter((p) => p.status === 'court') },
        { title: 'Bench', players: team.players.filter((p) => p.status === 'bench') },
        { title: 'Suspended / disqualified', players: team.players.filter((p) => p.status === 'suspended' || p.status === 'disqualified') }
      ]
    : [{ title: 'Squad', players: team.players }]
  return (
    <section
      aria-label={`${team.name} players`}
      className={cn('flex min-h-0 flex-col rounded-xl border bg-surface-1', armed ? 'border-primary/60' : 'border-border')}
    >
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <TeamCrest logoMediaId={team.logoMediaId} code={team.code} color={team.color} size={30} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-lg font-semibold leading-none tracking-wide">{team.name}</div>
          {trackCourt && (
            <div className={cn('mt-1 text-[11px] tabular', team.onCourt > team.allowedOnCourt ? 'font-semibold text-red-card' : 'text-faint')}>
              {team.onCourt} on court / {team.allowedOnCourt} allowed
            </div>
          )}
        </div>
        <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-faint">{team.side === 'home' ? 'H' : 'A'}</kbd>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {groups
          .filter((g) => g.players.length)
          .map((g) => (
            <div key={g.title}>
              <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
                {g.title} <span className="tabular">({g.players.length})</span>
              </h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
                {g.players.map((p) => (
                  <PlayerTile key={p.rosterId} p={p} color={team.color} selected={p.rosterId === selectedId} onClick={() => onSelect(p)} disabled={disabled} trackCourt={trackCourt} />
                ))}
              </div>
            </div>
          ))}
      </div>
    </section>
  )
}

interface TileProps {
  p: LivePlayerDTO
  color: string
  selected: boolean
  onClick: () => void
  disabled?: boolean
  trackCourt: boolean
}

function PlayerTile({ p, color, selected, onClick, disabled, trackCourt }: TileProps) {
  const out = p.status === 'disqualified'
  const susp = p.status === 'suspended'
  const bench = trackCourt && p.status === 'bench'
  const surname = p.name.split(' ').slice(-1)[0]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`#${p.jerseyNumber} ${p.name}, ${STATUS_LABEL[p.status]}${p.goals ? `, ${p.goals} goals` : ''}`}
      className={cn(
        'relative flex h-[74px] items-center gap-2.5 overflow-hidden rounded-lg border pl-2.5 pr-2 text-left transition-[border-color,background,opacity,box-shadow] disabled:cursor-not-allowed',
        selected ? 'border-primary bg-primary/12 shadow-[0_0_0_2px_var(--primary)]' : 'border-border bg-surface-2 hover:border-border-strong hover:bg-surface-hover',
        bench && !selected && 'opacity-70',
        susp && 'border-suspension/70 bg-suspension/10',
        out && 'border-red-card/60 bg-red-card/10 opacity-60'
      )}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} aria-hidden />
      <span
        className="grid h-12 min-w-12 shrink-0 place-items-center rounded-md px-1 font-display text-[30px] font-bold leading-none tabular"
        style={{ background: color, color: contrastOn(color) }}
      >
        {p.jerseyNumber}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[13px] font-semibold leading-tight', out && 'line-through')} title={p.name}>
          {surname}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-muted">
          {p.isGoalkeeper ? <b className="text-primary">GK</b> : p.position ? POSITION_SHORT[p.position] : ''}
          {p.isCaptain && <b className="rounded bg-gold/20 px-0.5 text-gold">C</b>}
          {susp && <b className="text-suspension">2 MIN</b>}
          {out && <b className="text-red-card">DISQ</b>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {p.photoMediaId && <PlayerAvatar photoMediaId={p.photoMediaId} name={p.name} size={26} />}
        {(p.goals > 0 || (p.isGoalkeeper && p.saves > 0)) && (
          <span className="rounded bg-goal/20 px-1 text-[10.5px] font-bold tabular text-goal">{p.isGoalkeeper && !p.goals ? `${p.saves} sv` : `${p.goals} g`}</span>
        )}
      </span>
    </button>
  )
}
