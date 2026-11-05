import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DraftOfficial } from './use-lineup-draft'

const SLOTS = ['A', 'B', 'C', 'D'] as const

interface Props {
  officials: DraftOfficial[]
  onChange: (o: DraftOfficial[]) => void
  disabled?: boolean
  max: number
}

/** Team officials on the match sheet (IHF 4:2: up to four, A-D). */
export function OfficialsEditor({ officials, onChange, disabled, max }: Props) {
  const free = SLOTS.filter((s) => !officials.some((o) => o.slot === s))
  const patch = (slot: string, v: Partial<DraftOfficial>) => onChange(officials.map((o) => (o.slot === slot ? { ...o, ...v } : o)))
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted">Team officials</h3>
        {!disabled && officials.length < Math.min(max, SLOTS.length) && (
          <Button size="sm" variant="ghost" onClick={() => onChange([...officials, { slot: free[0], name: '', role: 'Official' }])}>
            <Plus /> Add official
          </Button>
        )}
      </div>
      {officials.length === 0 && <p className="text-sm text-faint">No team officials entered.</p>}
      <div className="space-y-2">
        {[...officials]
          .sort((a, b) => a.slot.localeCompare(b.slot))
          .map((o) => (
            <div key={o.slot} className="flex items-center gap-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-lg font-bold">{o.slot}</span>
              <Input aria-label={`Official ${o.slot} name`} placeholder="Full name" disabled={disabled} value={o.name} onChange={(e) => patch(o.slot, { name: e.target.value })} />
              <Input aria-label={`Official ${o.slot} role`} placeholder="Role" className="w-40" disabled={disabled} value={o.role} onChange={(e) => patch(o.slot, { role: e.target.value })} />
              {!disabled && (
                <Button size="icon" variant="ghost" aria-label={`Remove official ${o.slot}`} onClick={() => onChange(officials.filter((x) => x.slot !== o.slot))}>
                  <X />
                </Button>
              )}
            </div>
          ))}
      </div>
    </div>
  )
}
