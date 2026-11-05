import { useState } from 'react'
import { Pencil, Undo2 } from 'lucide-react'
import { formatMatchTime } from '@shared/domain/periods'
import type { LiveEventDTO, LiveMatchDTO } from '@shared/dto'
import { Segmented } from '@/components/ui/table'
import { cn } from '@/lib/cn'
import { eventDetail, eventTitle, eventTone, type Tone } from './labels'

const TONE: Record<Tone, string> = {
  goal: 'text-goal',
  miss: 'text-text',
  play: 'text-muted',
  sub: 'text-primary',
  system: 'text-faint',
  note: 'text-muted',
  warning: 'text-yellow-card',
  suspension: 'text-suspension',
  red: 'text-red-card',
  timeout: 'text-timeout'
}

type Filter = 'all' | 'goals' | 'corrections'

const matches = (e: LiveEventDTO, f: Filter) =>
  f === 'goals' ? e.type === 'shot' && e.outcome === 'goal' && e.status === 'active' : f === 'corrections' ? e.status === 'voided' || !!e.replacesEventId : true

interface TimelineProps {
  live: LiveMatchDTO
  onEdit: (e: LiveEventDTO) => void
  onVoid: (e: LiveEventDTO) => void
}

/** The event ledger, newest first. Voided events stay visible, struck through, with the reason. */
export function Timeline({ live, onEdit, onVoid }: TimelineProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const rows = live.events.filter((e) => matches(e, filter))
  return (
    <section aria-label="Match timeline" className="flex min-h-44 flex-1 flex-col rounded-xl border border-border bg-surface-1">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted">Timeline</h2>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: live.events.length },
            { value: 'goals', label: 'Goals' },
            { value: 'corrections', label: 'Corrections' }
          ]}
        />
      </header>
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 && <li className="px-4 py-8 text-center text-sm text-faint">No events yet.</li>}
        {rows.map((e) => (
          <EventRow key={e.id} e={e} live={live} onEdit={onEdit} onVoid={onVoid} />
        ))}
      </ol>
    </section>
  )
}

function EventRow({ e, live, onEdit, onVoid }: { e: LiveEventDTO } & TimelineProps) {
  const voided = e.status === 'voided'
  const detail = eventDetail(e)
  return (
    <li className={cn('group flex items-start gap-2.5 border-b border-border/60 px-3 py-2 text-[13px]', voided && 'opacity-55')}>
      <span className="w-11 shrink-0 pt-0.5 text-right font-mono text-[12px] tabular text-muted">
        {e.type === 'period_start' || e.periodLabel === 'PS' ? e.periodLabel : formatMatchTime(e.matchMs)}
      </span>
      <span className="mt-0.5 h-4 w-1 shrink-0 rounded-full" style={{ background: e.side ? live[e.side].color : 'transparent' }} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className={cn('flex items-baseline gap-1.5', voided && 'line-through')}>
          <span className={cn('shrink-0 font-semibold', TONE[eventTone(e)])}>{eventTitle(e, live)}</span>
          {e.player ? (
            <span className="truncate">
              #{e.player.jerseyNumber} {e.player.name}
            </span>
          ) : e.official ? (
            <span className="truncate">
              Official {e.official.slot} {e.official.name}
            </span>
          ) : (
            e.side && e.type !== 'note' && <span className="text-muted">{live[e.side].code}</span>
          )}
        </div>
        {detail && <div className="truncate text-[11.5px] text-faint">{detail}</div>}
        {voided && <div className="text-[11.5px] text-red-card">Voided: {e.voidReason}</div>}
        {e.replacesEventId && !voided && <div className="text-[11.5px] text-warning">Corrected entry</div>}
      </div>
      {e.scoreAfter && !voided && (
        <span className="shrink-0 font-display text-[17px] font-bold tabular">
          {e.scoreAfter.home}:{e.scoreAfter.away}
        </span>
      )}
      {e.correctable && (
        <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {e.editable && (
            <button className="rounded p-1 text-muted hover:bg-surface-3 hover:text-text" aria-label="Correct event" title="Correct" onClick={() => onEdit(e)}>
              <Pencil className="size-3.5" />
            </button>
          )}
          <button className="rounded p-1 text-muted hover:bg-surface-3 hover:text-red-card" aria-label="Void event" title="Void (undo)" onClick={() => onVoid(e)}>
            <Undo2 className="size-3.5" />
          </button>
        </span>
      )}
    </li>
  )
}
