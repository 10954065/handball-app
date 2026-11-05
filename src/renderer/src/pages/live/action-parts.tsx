import type { ReactNode } from 'react'
import { MousePointerClick } from 'lucide-react'
import { SHOT_ZONE_LABELS, type ShotOutcome, type ShotSituation, type ShotZone, type Side } from '@shared/domain/constants'
import type { PlayKind } from '@shared/domain/live'
import type { LiveMatchDTO } from '@shared/dto'
import { cn } from '@/lib/cn'

export const SITUATIONS: { value: ShotSituation; label: string }[] = [
  { value: 'positional', label: 'Positional' },
  { value: 'fast_break', label: 'Fast break' },
  { value: 'seven_metre', label: '7 m' },
  { value: 'empty_goal', label: 'Empty goal' }
]

export const ZONES: { value: ShotZone; label: string }[] = (['wing', 'backcourt', 'pivot', 'breakthrough'] as const).map((z) => ({
  value: z,
  label: z === 'backcourt' ? '9 m' : z === 'pivot' ? '6 m' : SHOT_ZONE_LABELS[z]
}))

export const MISSES: { outcome: ShotOutcome; label: string; key: string }[] = [
  { outcome: 'saved', label: 'Saved', key: 'S' },
  { outcome: 'missed', label: 'Missed', key: 'M' },
  { outcome: 'post', label: 'Post', key: 'P' },
  { outcome: 'blocked', label: 'Blocked', key: 'B' }
]

export const PLAYS: { kind: PlayKind; label: string; key: string }[] = [
  { kind: 'technical_fault', label: 'Tech. fault', key: 'F' },
  { kind: 'turnover', label: 'Turnover', key: 'T' },
  { kind: 'steal', label: 'Steal', key: 'L' },
  { kind: 'block', label: 'Block', key: 'K' }
]

export const SANCTIONS = [
  { kind: 'warning', label: 'Warning', key: 'Y', tone: 'border-yellow-card/60 text-yellow-card hover:bg-yellow-card/10' },
  { kind: 'suspension', label: '2 min', key: 'X', tone: 'border-suspension/60 text-suspension hover:bg-suspension/10' },
  { kind: 'disqualification', label: 'Red card', key: 'R', tone: 'border-red-card/60 text-red-card hover:bg-red-card/10' }
] as const

/** Shortcut hint in the corner of a button, so it takes no width from the label. */
export const Key = ({ k }: { k: string }) => <kbd className="absolute right-1 top-0.5 font-mono text-[9px] leading-none opacity-60">{k}</kbd>

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-4 gap-1.5">{children}</div>
}

interface ChoiceProps<T extends string> {
  label: string
  value: T | null
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}

export function Choice<T extends string>({ label, value, options, onChange }: ChoiceProps<T>) {
  return (
    <div role="radiogroup" aria-label={label}>
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <div className="grid grid-cols-4 gap-1 rounded-lg border border-border bg-surface-2 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn('h-8 rounded-md px-1 text-[12px] font-medium transition-colors', value === o.value ? 'bg-primary text-primary-fg' : 'text-muted hover:text-text')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const K = ({ children }: { children: ReactNode }) => <kbd className="rounded border border-border px-1 font-mono">{children}</kbd>

export function IdlePanel({ typed, live }: { typed: { side: Side; digits: string } | null; live: LiveMatchDTO }) {
  return (
    <section aria-label="Record event" className="rounded-xl border border-dashed border-border-strong bg-surface-1 px-5 py-6 text-center">
      <MousePointerClick className="mx-auto size-6 text-faint" />
      {typed ? (
        <p className="mt-2 font-display text-3xl font-bold tabular">
          {live[typed.side].code} #{typed.digits || '_'}
        </p>
      ) : (
        <p className="mt-2 text-sm font-medium">Select a player</p>
      )}
      <p className="mx-auto mt-1 max-w-xs text-[12.5px] leading-relaxed text-muted">
        Click a tile, or press <K>H</K> / <K>A</K> and type the jersey number. <K>Space</K> starts and stops the clock, <K>Ctrl+Z</K> undoes the last entry.
      </p>
    </section>
  )
}
