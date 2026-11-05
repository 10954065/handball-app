import { teamInputSchema } from '@shared/schemas/entities'
import type { TeamDTO } from '@shared/dto'
import { ImagePicker } from '@/components/domain/image-picker'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Textarea } from '@/components/ui/input'
import { useForm } from '@/lib/form'
import { useApiMutation } from '@/lib/query'

interface Props {
  team?: TeamDTO
  onClose: () => void
  onSaved?: (id: string) => void
}

export function TeamFormDialog({ team, onClose, onSaved }: Props) {
  const f = useForm(teamInputSchema, {
    name: team?.name ?? '',
    shortName: team?.shortName ?? '',
    code: team?.code ?? '',
    country: team?.country ?? 'Ghana',
    region: team?.region ?? '',
    clubName: team?.clubName ?? '',
    homeVenue: team?.homeVenue ?? '',
    coach: team?.coach ?? '',
    assistantCoach: team?.assistantCoach ?? '',
    teamManager: team?.teamManager ?? '',
    primaryColor: team?.primaryColor ?? '#2563eb',
    secondaryColor: team?.secondaryColor ?? '#ffffff',
    logoMediaId: team?.logoMediaId ?? null,
    captainPlayerId: team?.captainPlayerId ?? null,
    primaryGoalkeeperId: team?.primaryGoalkeeperId ?? null,
    notes: team?.notes ?? ''
  })
  const done = (d: { id: string }) => {
    onSaved?.(d.id)
    onClose()
  }
  const create = useApiMutation('teams.create', { invalidate: ['teams.', 'dashboard.'], success: 'Team registered', onSuccess: done })
  const update = useApiMutation('teams.update', { invalidate: ['teams.', 'players.', 'dashboard.'], success: 'Team updated', onSuccess: done })
  const submit = () => {
    const v = f.validate()
    if (!v) return
    if (team) update.mutate({ ...v, id: team.id })
    else create.mutate(v)
  }
  const text = (k: 'name' | 'shortName' | 'code' | 'country' | 'region' | 'clubName' | 'homeVenue' | 'coach' | 'assistantCoach' | 'teamManager', label: string, required = false) => (
    <Field label={label} htmlFor={`t-${k}`} error={f.errors[k]} required={required}>
      <Input id={`t-${k}`} value={(f.values[k] as string) ?? ''} onChange={(e) => f.set(k, e.target.value)} />
    </Field>
  )

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={team ? `Edit ${team.name}` : 'Register team'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending || update.isPending} onClick={submit}>
            {team ? 'Save changes' : 'Register team'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <ImagePicker label="Team logo" value={f.values.logoMediaId} onChange={(id) => f.set('logoMediaId', id)} square={false} />
        <div className="grid grid-cols-6 gap-4">
          <div className="col-span-3">{text('name', 'Team name', true)}</div>
          <div className="col-span-2">{text('shortName', 'Short name', true)}</div>
          <div className="col-span-1">{text('code', 'Code', true)}</div>
          <div className="col-span-2">{text('clubName', 'Club')}</div>
          <div className="col-span-2">{text('region', 'Region')}</div>
          <div className="col-span-2">{text('country', 'Country')}</div>
          <div className="col-span-2">{text('coach', 'Coach')}</div>
          <div className="col-span-2">{text('assistantCoach', 'Assistant coach')}</div>
          <div className="col-span-2">{text('teamManager', 'Team manager')}</div>
          <div className="col-span-2">{text('homeVenue', 'Home venue')}</div>
          <Field label="Primary colour" htmlFor="t-pc" className="col-span-2" error={f.errors.primaryColor}>
            <div className="flex gap-2">
              <input id="t-pc" type="color" value={f.values.primaryColor} onChange={(e) => f.set('primaryColor', e.target.value)} className="h-10 w-14 cursor-pointer rounded-md border border-border bg-surface-2 p-1" />
              <Input value={f.values.primaryColor} onChange={(e) => f.set('primaryColor', e.target.value)} aria-label="Primary colour hex" />
            </div>
          </Field>
          <Field label="Secondary colour" htmlFor="t-sc" className="col-span-2" error={f.errors.secondaryColor}>
            <div className="flex gap-2">
              <input id="t-sc" type="color" value={f.values.secondaryColor} onChange={(e) => f.set('secondaryColor', e.target.value)} className="h-10 w-14 cursor-pointer rounded-md border border-border bg-surface-2 p-1" />
              <Input value={f.values.secondaryColor} onChange={(e) => f.set('secondaryColor', e.target.value)} aria-label="Secondary colour hex" />
            </div>
          </Field>
          <Field label="Notes" htmlFor="t-notes" className="col-span-6">
            <Textarea id="t-notes" value={f.values.notes ?? ''} onChange={(e) => f.set('notes', e.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  )
}
