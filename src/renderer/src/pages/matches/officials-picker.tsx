import { Plus, X } from 'lucide-react'
import { OFFICIAL_ROLE_LABELS } from '@shared/domain/constants'
import type { OfficialDTO } from '@shared/dto'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'

export interface AssignedOfficial {
  officialId: string
  role: string
}

interface Props {
  assigned: AssignedOfficial[]
  setAssigned: (v: AssignedOfficial[]) => void
  options: OfficialDTO[]
}

export function OfficialsPicker({ assigned, setAssigned, options }: Props) {
  const patch = (i: number, v: Partial<AssignedOfficial>) => setAssigned(assigned.map((x, j) => (j === i ? { ...x, ...v } : x)))
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-muted">Match officials</span>
        <Button size="sm" variant="ghost" disabled={assigned.length >= 8} onClick={() => setAssigned([...assigned, { officialId: '', role: 'Referee' }])}>
          <Plus /> Add
        </Button>
      </div>
      {assigned.length === 0 && <p className="text-sm text-faint">No officials assigned yet.</p>}
      <div className="space-y-2">
        {assigned.map((a, i) => (
          <div key={i} className="flex gap-2">
            <Select
              aria-label="Official"
              value={a.officialId}
              onChange={(e) => {
                const o = options.find((x) => x.id === e.target.value)
                patch(i, { officialId: e.target.value, role: o ? OFFICIAL_ROLE_LABELS[o.role] : a.role })
              }}
            >
              <option value="">Select official</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.fullName} ({OFFICIAL_ROLE_LABELS[o.role]})
                </option>
              ))}
            </Select>
            <Input aria-label="Role on this match" className="w-44" value={a.role} onChange={(e) => patch(i, { role: e.target.value })} />
            <Button size="icon" variant="ghost" aria-label="Remove official" onClick={() => setAssigned(assigned.filter((_, j) => j !== i))}>
              <X />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
