import { GENDERS, POSITION_LABELS, POSITIONS, REGISTRATION_STATUSES, type Position } from '@shared/domain/constants'
import { playerInputSchema } from '@shared/schemas/entities'
import type { PlayerDTO } from '@shared/dto'
import { ImagePicker } from '@/components/domain/image-picker'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { numOrNull, useForm } from '@/lib/form'
import { useApi, useApiMutation } from '@/lib/query'

interface Props {
  player?: PlayerDTO
  /** Pre-select a team when registering from a team page. */
  teamId?: string
  onClose: () => void
  onSaved?: (id: string) => void
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

export function PlayerFormDialog({ player, teamId, onClose, onSaved }: Props) {
  const teams = useApi('teams.list', undefined, { enabled: !player })
  const f = useForm(playerInputSchema, {
    firstName: player?.firstName ?? '',
    lastName: player?.lastName ?? '',
    dateOfBirth: player?.dateOfBirth ?? null,
    gender: player?.gender ?? null,
    nationality: player?.nationality ?? 'Ghana',
    position: player?.position ?? null,
    heightCm: player?.heightCm ?? null,
    isGoalkeeper: player?.isGoalkeeper ?? false,
    photoMediaId: player?.photoMediaId ?? null,
    registrationStatus: player?.registrationStatus ?? 'registered',
    notes: player?.notes ?? '',
    teamId: teamId ?? null,
    jerseyNumber: null
  })
  const done = (p: { id: string }) => {
    onSaved?.(p.id)
    onClose()
  }
  const create = useApiMutation('players.create', { invalidate: ['players.', 'teams.', 'dashboard.'], success: (p) => `${p.fullName} registered (${p.registrationNo})`, onSuccess: done })
  const update = useApiMutation('players.update', { invalidate: ['players.', 'teams.'], success: 'Player updated', onSuccess: done })
  const submit = () => {
    const v = f.validate()
    if (!v) return
    if (player) {
      const { teamId: _t, jerseyNumber: _j, ...rest } = v
      update.mutate({ ...rest, id: player.id })
    } else create.mutate(v)
  }
  const setPosition = (p: Position | null) => {
    f.set('position', p)
    if (p === 'goalkeeper') f.set('isGoalkeeper', true)
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={player ? `Edit ${player.fullName}` : 'Register player'}
      description={player ? `Player ID ${player.registrationNo}` : 'A permanent player ID is assigned automatically.'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending || update.isPending} onClick={submit}>
            {player ? 'Save changes' : 'Register player'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <ImagePicker label="Player photograph" value={f.values.photoMediaId} onChange={(id) => f.set('photoMediaId', id)} shape="circle" />
        <div className="grid grid-cols-6 gap-4">
          <Field label="First name" htmlFor="p-fn" error={f.errors.firstName} required className="col-span-3">
            <Input id="p-fn" value={f.values.firstName} onChange={(e) => f.set('firstName', e.target.value)} autoFocus />
          </Field>
          <Field label="Last name" htmlFor="p-ln" error={f.errors.lastName} required className="col-span-3">
            <Input id="p-ln" value={f.values.lastName} onChange={(e) => f.set('lastName', e.target.value)} />
          </Field>
          <Field label="Date of birth" htmlFor="p-dob" error={f.errors.dateOfBirth} className="col-span-2">
            <Input id="p-dob" type="date" value={f.values.dateOfBirth ?? ''} onChange={(e) => f.set('dateOfBirth', e.target.value || null)} />
          </Field>
          <Field label="Gender" htmlFor="p-g" className="col-span-2">
            <Select id="p-g" value={f.values.gender ?? ''} onChange={(e) => f.set('gender', (e.target.value || null) as never)}>
              <option value="">Not recorded</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>{cap(g)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Nationality" htmlFor="p-nat" className="col-span-2">
            <Input id="p-nat" value={f.values.nationality ?? ''} onChange={(e) => f.set('nationality', e.target.value)} />
          </Field>
          <Field label="Playing position" htmlFor="p-pos" className="col-span-3">
            <Select id="p-pos" value={f.values.position ?? ''} onChange={(e) => setPosition((e.target.value || null) as Position | null)}>
              <option value="">Not specified</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>{POSITION_LABELS[p]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Height (cm)" htmlFor="p-h" error={f.errors.heightCm} className="col-span-1">
            <Input id="p-h" type="number" value={f.values.heightCm ?? ''} onChange={(e) => f.set('heightCm', numOrNull(e.target.value))} />
          </Field>
          <Field label="Registration status" htmlFor="p-rs" className="col-span-2">
            <Select id="p-rs" value={f.values.registrationStatus} onChange={(e) => f.set('registrationStatus', e.target.value as never)}>
              {REGISTRATION_STATUSES.map((s) => (
                <option key={s} value={s}>{cap(s)}</option>
              ))}
            </Select>
          </Field>
          {!player && (
            <>
              <Field label="Team" htmlFor="p-team" className="col-span-4" hint="Optional. Transfers are managed from the player profile.">
                <Select id="p-team" value={f.values.teamId ?? ''} onChange={(e) => f.set('teamId', e.target.value || null)}>
                  <option value="">No team (free agent)</option>
                  {teams.data?.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Jersey number" htmlFor="p-j" error={f.errors.jerseyNumber} className="col-span-2">
                <Input id="p-j" type="number" min={1} max={99} disabled={!f.values.teamId} value={f.values.jerseyNumber ?? ''} onChange={(e) => f.set('jerseyNumber', numOrNull(e.target.value))} />
              </Field>
            </>
          )}
          <div className="col-span-6">
            <Switch label="Goalkeeper" description="Designated goalkeeper (can be selected as starting goalkeeper)." checked={!!f.values.isGoalkeeper} onCheckedChange={(v) => f.set('isGoalkeeper', v)} />
          </div>
          <Field label="Notes" htmlFor="p-notes" className="col-span-6">
            <Textarea id="p-notes" value={f.values.notes ?? ''} onChange={(e) => f.set('notes', e.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  )
}
