import { useState } from 'react'
import type { MatchDetailDTO } from '@shared/dto'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { useApi, useApiMutation } from '@/lib/query'
import { OfficialsPicker, type AssignedOfficial } from './officials-picker'

const pad = (n: number) => String(n).padStart(2, '0')

export function EditMatchDialog({ match, onClose }: { match: MatchDetailDTO; onClose: () => void }) {
  const venues = useApi('venues.list')
  const officials = useApi('officials.list')
  const d = new Date(match.scheduledAt)
  const [date, setDate] = useState(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
  const [time, setTime] = useState(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
  const [venueId, setVenue] = useState(match.venueId ?? '')
  const [assigned, setAssigned] = useState<AssignedOfficial[]>(match.officials.map((o) => ({ officialId: o.officialId, role: o.role })))
  const update = useApiMutation('matches.update', { invalidate: ['matches.', 'dashboard.', 'officials.'], success: 'Match updated', onSuccess: onClose })
  const save = () =>
    update.mutate({ id: match.id, scheduledAt: new Date(`${date}T${time}`).getTime(), venueId: venueId || null, officials: assigned.filter((a) => a.officialId) })
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit ${match.matchNumber}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={update.isPending} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date" htmlFor="em-d"><Input id="em-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Throw-off time" htmlFor="em-t"><Input id="em-t" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label="Venue" htmlFor="em-v">
            <Select id="em-v" value={venueId} onChange={(e) => setVenue(e.target.value)}>
              <option value="">Not specified</option>
              {venues.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </Field>
        </div>
        <OfficialsPicker assigned={assigned} setAssigned={setAssigned} options={officials.data ?? []} />
      </div>
    </Dialog>
  )
}
