import type { StandingRowDTO } from '@shared/dto'
import { cn } from '@/lib/cn'
import { TeamCrest } from './identity'

export function StandingsTable({ rows, compact }: { rows: StandingRowDTO[]; compact?: boolean }) {
  const groups = [...new Set(rows.map((r) => r.groupName))]
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g || 'all'}>
          {g && <div className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-gold">Group {g}</div>}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-faint">
                <th className="w-10 px-3 py-2 text-left font-semibold">#</th>
                <th className="py-2 text-left font-semibold">Team</th>
                <th className="w-10 py-2 text-center font-semibold">P</th>
                {!compact && <th className="w-10 py-2 text-center font-semibold">W</th>}
                {!compact && <th className="w-10 py-2 text-center font-semibold">D</th>}
                {!compact && <th className="w-10 py-2 text-center font-semibold">L</th>}
                {!compact && <th className="w-20 py-2 text-center font-semibold">Goals</th>}
                <th className="w-12 py-2 text-center font-semibold">+/-</th>
                <th className="w-12 px-3 py-2 text-right font-semibold">Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => r.groupName === g)
                .map((r) => (
                  <tr key={r.teamId} className="border-t border-border/60">
                    <td className={cn('px-3 py-2 font-display text-base font-semibold tabular', r.rank === 1 && 'text-gold')} title={r.unresolvedTie ? 'Level on every criterion. The order shown is alphabetical.' : undefined}>
                      {r.rank}
                      {r.unresolvedTie && '='}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-2.5">
                        <TeamCrest logoMediaId={r.logoMediaId} code={r.code} color={r.primaryColor} size={24} />
                        <span className="truncate font-medium">{r.teamName}</span>
                      </div>
                    </td>
                    <td className="py-2 text-center tabular text-muted">{r.played}</td>
                    {!compact && <td className="py-2 text-center tabular text-muted">{r.won}</td>}
                    {!compact && <td className="py-2 text-center tabular text-muted">{r.drawn}</td>}
                    {!compact && <td className="py-2 text-center tabular text-muted">{r.lost}</td>}
                    {!compact && <td className="py-2 text-center tabular text-muted">{r.goalsFor}:{r.goalsAgainst}</td>}
                    <td className="py-2 text-center tabular text-muted">{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</td>
                    <td className="px-3 py-2 text-right font-display text-lg font-bold tabular">{r.points}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
      {rows.some((r) => r.unresolvedTie) && <p className="px-4 pb-3 text-xs text-warning">= Level on every criterion. The order shown is alphabetical: settle it under the regulations.</p>}
    </div>
  )
}
