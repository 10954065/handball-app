import { useState } from 'react'
import { fixtureGroups, planFixtures } from '@shared/domain/fixtures'
import type { SeasonDTO } from '@shared/dto'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { ErrorNote } from '@/components/ui/misc'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { useApi, useApiMutation } from '@/lib/query'

const PREVIEW_MATCHES = 6

/** Create every league or group fixture of a season, with a preview before anything is saved. */
export function GenerateFixturesDialog({ season, grouped, onClose }: { season: SeasonDTO; grouped: boolean; onClose: () => void }) {
  const venues = useApi('venues.list')
  const [legs, setLegs] = useState<1 | 2>(1)
  const [date, setDate] = useState(season.startDate ?? '')
  const [time, setTime] = useState('14:00')
  const [days, setDays] = useState(7)
  const [gap, setGap] = useState(90)
  const [venueId, setVenueId] = useState('')
  const generate = useApiMutation('fixtures.generate', {
    invalidate: ['matches.', 'competitions.', 'seasons.', 'dashboard.', 'knockout.'],
    success: (r) => `${r.created} fixtures created`,
    onSuccess: onClose,
    toastError: false
  })
  const firstKickoff = new Date(`${date}T${time || '00:00'}`).getTime()
  const { groups, problem } = fixtureGroups(season.teams, grouped)
  const valid = !problem && !Number.isNaN(firstKickoff) && days >= 1 && gap >= 15
  const plan = valid ? planFixtures(groups, { legs, firstKickoff, daysBetweenRounds: days, minutesBetweenMatches: gap }) : []
  const nameOf = (id: string) => season.teams.find((t) => t.teamId === id)?.teamName ?? id
  const rounds = plan.length ? Math.max(...plan.map((f) => f.round)) : 0

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Generate fixtures"
      description={grouped ? 'Every team plays the others in its group.' : 'Every team plays every other team.'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!plan.length}
            loading={generate.isPending}
            onClick={() => generate.mutate({ seasonId: season.id, legs, firstKickoff, daysBetweenRounds: days, minutesBetweenMatches: gap, venueId: venueId || null })}
          >
            Create {plan.length} fixtures
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Field label="Format" htmlFor="fx-legs">
          <Select id="fx-legs" value={legs} onChange={(e) => setLegs(Number(e.target.value) === 2 ? 2 : 1)}>
            <option value={1}>Single round</option>
            <option value={2}>Home and away</option>
          </Select>
        </Field>
        <Field label="First match day" htmlFor="fx-date" required>
          <Input id="fx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="First throw-off" htmlFor="fx-time" required>
          <Input id="fx-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="Days between rounds" htmlFor="fx-days">
          <Input id="fx-days" type="number" min={1} max={60} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </Field>
        <Field label="Minutes between matches" htmlFor="fx-gap" hint="On the same match day.">
          <Input id="fx-gap" type="number" min={15} max={600} step={15} value={gap} onChange={(e) => setGap(Number(e.target.value))} />
        </Field>
        <Field label="Venue" htmlFor="fx-venue">
          <Select id="fx-venue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
            <option value="">Decide later</option>
            {venues.data?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {problem && <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{problem}</p>}
      {generate.error && <div className="mt-4"><ErrorNote error={generate.error} /></div>}
      {plan.length > 0 && (
        <section className="mt-5 rounded-lg border border-border bg-surface-2 px-4 py-3" aria-label="Fixture preview">
          <p className="text-sm font-medium">
            {plan.length} matches in {rounds} {rounds === 1 ? 'round' : 'rounds'}, from {fmtDate(plan[0].scheduledAt)} to {fmtDate(plan[plan.length - 1].scheduledAt)}.
          </p>
          <ul className="mt-2 space-y-1 text-[13px] text-muted">
            {plan.slice(0, PREVIEW_MATCHES).map((f) => (
              <li key={`${f.round}-${f.homeTeamId}-${f.awayTeamId}`} className="flex justify-between gap-4">
                <span>
                  Round {f.round}
                  {f.groupName && `, group ${f.groupName}`}: {nameOf(f.homeTeamId)} v {nameOf(f.awayTeamId)}
                </span>
                <span className="shrink-0 tabular text-faint">{fmtDateTime(f.scheduledAt)}</span>
              </li>
            ))}
            {plan.length > PREVIEW_MATCHES && <li className="text-faint">and {plan.length - PREVIEW_MATCHES} more</li>}
          </ul>
        </section>
      )}
    </Dialog>
  )
}
