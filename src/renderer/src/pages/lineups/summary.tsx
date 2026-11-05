import { POSITION_SHORT } from '@shared/domain/constants'
import type { SideSetupDTO } from '@shared/dto'
import { contrastOn, PlayerAvatar, TeamCrest } from '@/components/domain/identity'

/** Compact read-only view of a confirmed lineup: starting seven, substitutes, officials. */
export function LineupSummary({ side }: { side: SideSetupDTO }) {
  const starters = side.entries
    .filter((e) => e.isStarting)
    .sort((a, b) => Number(b.isStartingGk) - Number(a.isStartingGk) || a.jerseyNumber - b.jerseyNumber)
  const subs = side.entries.filter((e) => !e.isStarting)
  return (
    <div className="bg-surface-1 p-5">
      <div className="mb-3 flex items-center gap-3">
        <TeamCrest logoMediaId={side.logoMediaId} code={side.code} color={side.color} size={32} />
        <span className="font-display text-xl font-bold tracking-wide">{side.teamName}</span>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {starters.map((e) => (
          <div key={e.rosterId} className="flex flex-col items-center gap-1.5 text-center">
            <div className="relative">
              <PlayerAvatar photoMediaId={e.photoMediaId} name={e.name} size={52} />
              <span
                className="absolute -bottom-1 -right-2 grid h-6 min-w-6 place-items-center rounded-md px-1 font-display text-sm font-bold"
                style={{ background: side.color, color: contrastOn(side.color) }}
              >
                {e.jerseyNumber}
              </span>
            </div>
            <span className="line-clamp-2 text-[11px] font-medium leading-tight">{e.name}</span>
            <span className="text-[10px] text-muted">
              {e.isStartingGk ? 'GK' : e.position ? POSITION_SHORT[e.position] : ''}
              {e.isCaptain && <span className="ml-1 font-bold text-gold">C</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 text-xs text-muted">
        <span className="font-semibold uppercase tracking-wider text-faint">Substitutes </span>
        {subs.map((e) => `#${e.jerseyNumber} ${e.name}`).join(', ') || 'none'}
      </div>
      <div className="mt-1.5 text-xs text-muted">
        <span className="font-semibold uppercase tracking-wider text-faint">Officials </span>
        {side.officials.map((o) => `${o.slot}: ${o.name}`).join(', ') || 'none'}
      </div>
    </div>
  )
}
