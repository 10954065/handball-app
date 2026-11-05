import { useState } from 'react'
import type { PlayerDTO } from '@shared/dto'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { numOrNull } from '@/lib/form'
import { useApi, useApiMutation } from '@/lib/query'

export function TransferDialog({ player, onClose }: { player: PlayerDTO; onClose: () => void }) {
  const teams = useApi('teams.list')
  const [toTeamId, setTo] = useState('')
  const [jersey, setJersey] = useState<number | null>(player.jerseyNumber)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const transfer = useApiMutation('players.transfer', {
    invalidate: ['players.', 'teams.'],
    success: (p) => (p.teamName ? `${p.fullName} transferred to ${p.teamName}` : `${p.fullName} released`),
    onSuccess: onClose
  })
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Transfer ${player.fullName}`}
      description={`Current team: ${player.teamName ?? 'none'}. Past matches keep their original team and jersey.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={transfer.isPending} onClick={() => transfer.mutate({ playerId: player.id, toTeamId: toTeamId || null, jerseyNumber: toTeamId ? jersey : null, effectiveDate: date })}>
            {toTeamId ? 'Confirm transfer' : 'Release player'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-4">
        <Field label="New team" htmlFor="tr-team" className="col-span-3">
          <Select id="tr-team" value={toTeamId} onChange={(e) => setTo(e.target.value)}>
            <option value="">Release (free agent)</option>
            {teams.data
              ?.filter((t) => t.id !== player.teamId)
              .map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
          </Select>
        </Field>
        <Field label="Jersey number" htmlFor="tr-j">
          <Input id="tr-j" type="number" min={1} max={99} disabled={!toTeamId} value={jersey ?? ''} onChange={(e) => setJersey(numOrNull(e.target.value))} />
        </Field>
        <Field label="Effective date" htmlFor="tr-d" className="col-span-2">
          <Input id="tr-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}

export function JerseyDialog({ player, onClose }: { player: PlayerDTO; onClose: () => void }) {
  const [jersey, setJersey] = useState<number | null>(player.jerseyNumber)
  const change = useApiMutation('players.changeJersey', { invalidate: ['players.', 'teams.'], success: 'Jersey number changed', onSuccess: onClose })
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Change jersey number"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={change.isPending} disabled={!jersey} onClick={() => jersey && change.mutate({ playerId: player.id, jerseyNumber: jersey })}>
            Save
          </Button>
        </>
      }
    >
      <Field label={`Jersey number at ${player.teamName}`} htmlFor="jd" hint="Numbers must be unique in the team. Past matches keep their number.">
        <Input id="jd" type="number" min={1} max={99} value={jersey ?? ''} onChange={(e) => setJersey(numOrNull(e.target.value))} autoFocus />
      </Field>
    </Dialog>
  )
}
