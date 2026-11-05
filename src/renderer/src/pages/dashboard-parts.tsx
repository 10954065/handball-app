import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Goal, type LucideIcon } from 'lucide-react'
import type { DashboardDTO } from '@shared/dto'
import { PlayerAvatar } from '@/components/domain/identity'
import { EmptyState, Panel, PanelHeader } from '@/components/ui/misc'
import { fmtDateTime } from '@/lib/format'

export function QuickAction({ icon: Icon, label, onClick, primary }: { icon: LucideIcon; label: string; onClick: () => void; primary?: boolean }) {
  const tone = primary ? 'border-primary/50 bg-primary/12 hover:bg-primary/20' : 'border-border bg-surface-1 hover:border-border-strong hover:bg-surface-2'
  return (
    <button onClick={onClick} className={`flex h-16 items-center gap-3 rounded-xl border px-5 text-left font-semibold transition-colors ${tone}`}>
      <Icon className={`size-5 ${primary ? 'text-primary' : 'text-muted'}`} /> {label}
    </button>
  )
}

interface SectionProps {
  title: string
  icon: LucideIcon
  action?: ReactNode
  children: ReactNode
  className?: string
}

export function Section({ title, icon: Icon, action, children, className }: SectionProps) {
  return (
    <Panel className={className}>
      <PanelHeader title={<span className="flex items-center gap-2"><Icon className="size-4" /> {title}</span>} actions={action} />
      {children}
    </Panel>
  )
}

export function TopScorers({ rows }: { rows: DashboardDTO['topScorers'] }) {
  if (!rows.length) return <EmptyState className="py-8" icon={Goal} title="No goals recorded yet" />
  return (
    <ol className="divide-y divide-border">
      {rows.map((s, i) => (
        <li key={s.playerId}>
          <Link to={`/players/${s.playerId}`} className="flex items-center gap-3 px-5 py-2 hover:bg-surface-2">
            <span className="w-5 font-display text-lg font-semibold text-faint tabular">{i + 1}</span>
            <PlayerAvatar photoMediaId={s.photoMediaId} name={s.name} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{s.name}</span>
              <span className="block truncate text-xs text-muted">{s.teamName ?? '-'}</span>
            </span>
            <span className="font-display text-2xl font-bold tabular text-goal">{s.goals}</span>
          </Link>
        </li>
      ))}
    </ol>
  )
}

export function ActivityList({ rows }: { rows: DashboardDTO['activity'] }) {
  if (!rows.length) return <EmptyState className="py-8" icon={Activity} title="No activity yet" />
  return (
    <ul className="divide-y divide-border">
      {rows.map((a) => (
        <li key={a.id} className="flex items-center gap-3 px-5 py-2 text-xs">
          <span className="w-32 shrink-0 tabular text-faint">{fmtDateTime(a.at)}</span>
          <span className="font-mono text-primary">{a.action}</span>
          <span className="ml-auto truncate text-muted">{a.username ?? 'system'}</span>
        </li>
      ))}
    </ul>
  )
}
