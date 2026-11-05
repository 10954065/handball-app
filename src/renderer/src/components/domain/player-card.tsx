import type { ReactNode } from 'react'
import { POSITION_LABELS, POSITION_SHORT, type Position } from '@shared/domain/constants'
import { cn } from '@/lib/cn'
import { contrastOn, PlayerAvatar } from './identity'

interface PlayerCardProps {
  name: string
  jersey: number | null
  position: Position | null
  photoMediaId: string | null
  color: string
  captain?: boolean
  goalkeeper?: boolean
  selected?: boolean
  dimmed?: boolean
  onClick?: () => void
  footer?: ReactNode
  className?: string
}

/**
 * Visual player card: photograph, large jersey number, name and position.
 * Used for team rosters and the starting lineup selection.
 */
export function PlayerCard({ name, jersey, position, photoMediaId, color, captain, goalkeeper, selected, dimmed, onClick, footer, className }: PlayerCardProps) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={onClick ? !!selected : undefined}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border bg-surface-1 text-left transition-[border-color,background,opacity,box-shadow]',
        selected ? 'border-primary shadow-[0_0_0_1px_var(--primary)]' : 'border-border hover:border-border-strong',
        onClick && 'cursor-pointer hover:bg-surface-2',
        dimmed && 'opacity-45',
        className
      )}
    >
      <div className="relative flex items-end gap-3 px-3 pt-3">
        <PlayerAvatar photoMediaId={photoMediaId} name={name} size={64} rounded="lg" />
        <span
          className="ml-auto font-display text-[44px] font-bold leading-[0.8] tabular"
          style={{ color, textShadow: contrastOn(color) === '#ffffff' ? undefined : '0 0 1px rgba(0,0,0,.6)' }}
        >
          {jersey ?? '-'}
        </span>
      </div>
      <div className="px-3 pb-3 pt-2.5">
        <div className="truncate text-[13.5px] font-semibold leading-tight" title={name}>
          {name}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
          <span title={position ? POSITION_LABELS[position] : undefined}>{position ? POSITION_SHORT[position] : 'Position n/a'}</span>
          {captain && <span className="rounded bg-gold/20 px-1 font-bold text-gold" title="Captain">C</span>}
          {goalkeeper && <span className="rounded bg-primary/20 px-1 font-bold text-primary" title="Goalkeeper">GK</span>}
        </div>
        {footer && <div className="mt-2.5">{footer}</div>}
      </div>
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: color }} />
    </Comp>
  )
}
