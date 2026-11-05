import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Shuffle } from 'lucide-react'
import { hasThirdPlace, MAX_BRACKET_TEAMS } from '@shared/domain/bracket'
import type { KnockoutProposalDTO, SeasonDTO } from '@shared/dto'
import { TeamCrest } from '@/components/domain/identity'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { ErrorNote, Spinner } from '@/components/ui/misc'
import { Switch } from '@/components/ui/switch'
import { useApi, useApiMutation } from '@/lib/query'

type Entry = KnockoutProposalDTO['teams'][number]

const DEFAULT_QUALIFIERS = 2

function shuffled<T>(list: readonly T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Confirm the teams and seeding of a bracket. The list order is the seeding. */
export function CreateBracketDialog({ season, fromGroups, onClose }: { season: SeasonDTO; fromGroups: boolean; onClose: () => void }) {
  const [qualifiers, setQualifiers] = useState(DEFAULT_QUALIFIERS)
  const [thirdPlace, setThirdPlace] = useState(true)
  const [order, setOrder] = useState<Entry[]>([])
  const proposal = useApi('knockout.proposal', { seasonId: season.id, qualifiersPerGroup: qualifiers }, { staleTime: 0 })
  useEffect(() => setOrder(proposal.data?.teams ?? []), [proposal.data])
  const create = useApiMutation('knockout.create', {
    invalidate: ['knockout.', 'competitions.', 'seasons.'],
    success: 'Bracket created',
    onSuccess: onClose,
    toastError: false
  })
  const move = (i: number, by: number) => {
    const next = [...order]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    setOrder(next)
  }
  const tooMany = order.length > MAX_BRACKET_TEAMS
  const blocked = proposal.data?.blocked ?? (tooMany ? `A bracket can hold at most ${MAX_BRACKET_TEAMS} teams.` : null)
  const full = 2 ** Math.ceil(Math.log2(Math.max(order.length, 2)))
  const byes = full - order.length

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create the knockout bracket"
      description="The list is the seeding, best first. The top seeds meet as late as possible."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!!blocked || order.length < 2} loading={create.isPending} onClick={() => create.mutate({ seasonId: season.id, teamIds: order.map((t) => t.teamId), thirdPlace })}>
            Create bracket
          </Button>
        </>
      }
    >
      {fromGroups ? (
        <Field label="Teams qualifying from each group" htmlFor="ko-qualifiers" className="mb-3">
          <Input id="ko-qualifiers" type="number" min={1} max={8} value={qualifiers} onChange={(e) => setQualifiers(Math.max(1, Math.min(8, Number(e.target.value) || 1)))} />
        </Field>
      ) : (
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => setOrder(shuffled(order))}>
            <Shuffle /> Draw at random
          </Button>
        </div>
      )}
      {proposal.isLoading && <Spinner />}
      {proposal.error && <ErrorNote error={proposal.error} />}
      {blocked && <p className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{blocked}</p>}
      {proposal.data?.warnings.map((w) => (
        <p key={w} className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {w}
        </p>
      ))}
      <ol className="divide-y divide-border rounded-lg border border-border" aria-label="Seeding">
        {order.map((t, i) => (
          <li key={t.teamId} className="flex items-center gap-3 px-3 py-1.5">
            <span className="w-5 text-right font-display text-base font-semibold tabular text-muted">{i + 1}</span>
            <TeamCrest logoMediaId={t.logoMediaId} code={t.code} color={t.color} size={26} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</span>
            {t.label && <span className="font-mono text-xs text-faint">{t.label}</span>}
            <button className="rounded p-1 text-muted hover:bg-surface-3 hover:text-text disabled:opacity-30" disabled={i === 0} aria-label={`Move ${t.name} up`} onClick={() => move(i, -1)}>
              <ArrowUp className="size-4" />
            </button>
            <button className="rounded p-1 text-muted hover:bg-surface-3 hover:text-text disabled:opacity-30" disabled={i === order.length - 1} aria-label={`Move ${t.name} down`} onClick={() => move(i, 1)}>
              <ArrowDown className="size-4" />
            </button>
          </li>
        ))}
      </ol>
      {byes > 0 && order.length >= 2 && (
        <p className="mt-2 text-xs text-muted">
          {byes} top {byes === 1 ? 'seed goes' : 'seeds go'} straight to the second round.
        </p>
      )}
      <div className="mt-3">
        <Switch checked={thirdPlace && hasThirdPlace(order.length)} disabled={!hasThirdPlace(order.length)} onCheckedChange={setThirdPlace} label="Third-place match" description="Played by the two losing semi-finalists. Needs at least four teams." />
      </div>
      {create.error && <div className="mt-3"><ErrorNote error={create.error} /></div>}
    </Dialog>
  )
}

/** Choose when and where the match of a tie is played. */
export function ScheduleTieDialog({ title, startDate, onSubmit, busy, error, onClose }: { title: string; startDate: string | null; onSubmit: (scheduledAt: number, venueId: string | null) => void; busy: boolean; error: unknown; onClose: () => void }) {
  const venues = useApi('venues.list')
  const [date, setDate] = useState(startDate ?? '')
  const [time, setTime] = useState('16:00')
  const [venueId, setVenueId] = useState('')
  const scheduledAt = new Date(`${date}T${time || '00:00'}`).getTime()
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Schedule this match"
      description={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={Number.isNaN(scheduledAt)} loading={busy} onClick={() => onSubmit(scheduledAt, venueId || null)}>Create fixture</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Date" htmlFor="tie-date" required>
          <Input id="tie-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Throw-off" htmlFor="tie-time" required>
          <Input id="tie-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="Venue" htmlFor="tie-venue" className="col-span-2">
          <Select id="tie-venue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
            <option value="">Decide later</option>
            {venues.data?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="mt-3 text-xs text-muted">A knockout match needs a winner. If it stays level it goes to the competition's overtime, then a penalty shoot-out.</p>
      {!!error && <div className="mt-3"><ErrorNote error={error} /></div>}
    </Dialog>
  )
}
