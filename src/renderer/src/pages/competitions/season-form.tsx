import { useState } from 'react'
import type { SeasonDTO } from '@shared/dto'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { useApiMutation } from '@/lib/query'

export function SeasonDialog({ competitionId, season, onClose, onSaved }: { competitionId: string; season?: SeasonDTO; onClose: () => void; onSaved?: (id: string) => void }) {
  const [name, setName] = useState(season?.name ?? '')
  const [startDate, setStart] = useState(season?.startDate ?? '')
  const [endDate, setEnd] = useState(season?.endDate ?? '')
  const [status, setStatus] = useState<SeasonDTO['status']>(season?.status ?? 'planned')
  const opts = { invalidate: ['competitions.', 'dashboard.'], onSuccess: (s: SeasonDTO) => { onSaved?.(s.id); onClose() } }
  const create = useApiMutation('seasons.create', { ...opts, success: 'Season created' })
  const update = useApiMutation('seasons.update', { ...opts, success: 'Season updated' })
  const submit = () => {
    const v = { name, startDate: startDate || null, endDate: endDate || null, status }
    if (season) update.mutate({ ...v, id: season.id })
    else create.mutate({ ...v, competitionId })
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={season ? `Edit season ${season.name}` : 'New season'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim()} loading={create.isPending || update.isPending} onClick={submit}>Save</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Season name" htmlFor="s-n" className="col-span-2" required>
          <Input id="s-n" placeholder="e.g. 2026/27" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Start" htmlFor="s-s"><Input id="s-s" type="date" value={startDate} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="End" htmlFor="s-e"><Input id="s-e" type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Status" htmlFor="s-st" className="col-span-2">
          <Select id="s-st" value={status} onChange={(e) => setStatus(e.target.value as SeasonDTO['status'])}>
            <option value="planned">Planned</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  )
}
