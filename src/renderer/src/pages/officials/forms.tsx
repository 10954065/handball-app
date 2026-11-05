import { OFFICIAL_ROLE_LABELS, OFFICIAL_ROLES } from '@shared/domain/constants'
import type { OfficialDTO, VenueDTO } from '@shared/dto'
import { officialInputSchema, venueInputSchema } from '@shared/schemas/entities'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Select, Textarea } from '@/components/ui/input'
import { numOrNull, useForm } from '@/lib/form'
import { useApiMutation } from '@/lib/query'

export function OfficialDialog({ official, onClose }: { official?: OfficialDTO; onClose: () => void }) {
  const f = useForm(officialInputSchema, {
    fullName: official?.fullName ?? '',
    role: official?.role ?? 'referee',
    licenseNo: official?.licenseNo ?? '',
    region: official?.region ?? '',
    phone: official?.phone ?? '',
    email: official?.email ?? '',
    notes: official?.notes ?? ''
  })
  const create = useApiMutation('officials.create', { invalidate: ['officials.', 'dashboard.'], success: 'Official added', onSuccess: onClose })
  const update = useApiMutation('officials.update', { invalidate: ['officials.'], success: 'Official updated', onSuccess: onClose })
  const submit = () => {
    const v = f.validate()
    if (!v) return
    if (official) update.mutate({ ...v, id: official.id })
    else create.mutate(v)
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={official ? `Edit ${official.fullName}` : 'Add match official'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending || update.isPending} onClick={submit}>{official ? 'Save' : 'Add official'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Full name" htmlFor="o-n" error={f.errors.fullName} required className="col-span-2">
          <Input id="o-n" value={f.values.fullName} onChange={(e) => f.set('fullName', e.target.value)} autoFocus />
        </Field>
        <Field label="Role" htmlFor="o-r">
          <Select id="o-r" value={f.values.role} onChange={(e) => f.set('role', e.target.value as never)}>
            {OFFICIAL_ROLES.map((r) => (
              <option key={r} value={r}>{OFFICIAL_ROLE_LABELS[r]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Licence number" htmlFor="o-l">
          <Input id="o-l" value={f.values.licenseNo ?? ''} onChange={(e) => f.set('licenseNo', e.target.value)} />
        </Field>
        <Field label="Region" htmlFor="o-reg">
          <Input id="o-reg" value={f.values.region ?? ''} onChange={(e) => f.set('region', e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor="o-p">
          <Input id="o-p" value={f.values.phone ?? ''} onChange={(e) => f.set('phone', e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="o-e" error={f.errors.email} className="col-span-2">
          <Input id="o-e" type="email" value={f.values.email ?? ''} onChange={(e) => f.set('email', e.target.value)} />
        </Field>
        <Field label="Notes" htmlFor="o-notes" className="col-span-2">
          <Textarea id="o-notes" value={f.values.notes ?? ''} onChange={(e) => f.set('notes', e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}

export function VenueDialog({ venue, onClose }: { venue?: VenueDTO; onClose: () => void }) {
  const f = useForm(venueInputSchema, { name: venue?.name ?? '', city: venue?.city ?? '', address: venue?.address ?? '', capacity: venue?.capacity ?? null, notes: venue?.notes ?? '' })
  const create = useApiMutation('venues.create', { invalidate: ['venues.'], success: 'Venue added', onSuccess: onClose })
  const update = useApiMutation('venues.update', { invalidate: ['venues.', 'matches.'], success: 'Venue updated', onSuccess: onClose })
  const submit = () => {
    const v = f.validate()
    if (!v) return
    if (venue) update.mutate({ ...v, id: venue.id })
    else create.mutate(v)
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={venue ? `Edit ${venue.name}` : 'Add venue'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending || update.isPending} onClick={submit}>{venue ? 'Save' : 'Add venue'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Venue name" htmlFor="v-n" error={f.errors.name} required className="col-span-2">
          <Input id="v-n" value={f.values.name} onChange={(e) => f.set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="City" htmlFor="v-c">
          <Input id="v-c" value={f.values.city ?? ''} onChange={(e) => f.set('city', e.target.value)} />
        </Field>
        <Field label="Capacity" htmlFor="v-cap" error={f.errors.capacity}>
          <Input id="v-cap" type="number" value={f.values.capacity ?? ''} onChange={(e) => f.set('capacity', numOrNull(e.target.value))} />
        </Field>
        <Field label="Address" htmlFor="v-a" className="col-span-2">
          <Input id="v-a" value={f.values.address ?? ''} onChange={(e) => f.set('address', e.target.value)} />
        </Field>
        <Field label="Notes" htmlFor="v-notes" className="col-span-2">
          <Textarea id="v-notes" value={f.values.notes ?? ''} onChange={(e) => f.set('notes', e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}
