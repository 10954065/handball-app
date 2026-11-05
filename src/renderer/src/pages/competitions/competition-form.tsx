import { ArrowDown, ArrowUp } from 'lucide-react'
import { COMPETITION_TYPE_LABELS, COMPETITION_TYPES } from '@shared/domain/constants'
import { DEFAULT_RULES, findPreset } from '@shared/domain/rules'
import type { CompetitionDTO } from '@shared/dto'
import { competitionInputSchema, TIEBREAKERS, type Tiebreaker } from '@shared/schemas/entities'
import { RulesEditor } from '@/components/domain/rules-editor'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { useForm } from '@/lib/form'
import { useApiMutation } from '@/lib/query'

export const TIEBREAKER_LABELS: Record<Tiebreaker, string> = {
  points: 'Points',
  head_to_head_points: 'Head-to-head points',
  head_to_head_goal_difference: 'Head-to-head goal difference',
  head_to_head_goals: 'Head-to-head goals scored',
  goal_difference: 'Goal difference',
  goals_for: 'Goals scored',
  wins: 'Wins'
}

export function CompetitionDialog({ competition, onClose, onSaved }: { competition?: CompetitionDTO; onClose: () => void; onSaved?: (id: string) => void }) {
  const f = useForm(competitionInputSchema, {
    name: competition?.name ?? '',
    shortName: competition?.shortName ?? '',
    type: competition?.type ?? 'league',
    category: competition?.category ?? '',
    organizer: competition?.organizer ?? '',
    rules: competition?.rules ?? DEFAULT_RULES,
    pointsWin: competition?.pointsWin ?? 2,
    pointsDraw: competition?.pointsDraw ?? 1,
    pointsLoss: competition?.pointsLoss ?? 0,
    tiebreakers: (competition?.tiebreakers as Tiebreaker[]) ?? ['points', 'head_to_head_points', 'head_to_head_goal_difference', 'goal_difference', 'goals_for'],
    logoMediaId: competition?.logoMediaId ?? null
  })
  const done = (c: { id: string }) => {
    onSaved?.(c.id)
    onClose()
  }
  const create = useApiMutation('competitions.create', { invalidate: ['competitions.', 'dashboard.'], success: 'Competition created', onSuccess: done })
  const update = useApiMutation('competitions.update', { invalidate: ['competitions.'], success: 'Competition updated', onSuccess: done })
  const submit = () => {
    const v = f.validate()
    if (!v) return
    if (competition) update.mutate({ ...v, id: competition.id })
    else create.mutate(v)
  }
  const tbs = f.values.tiebreakers as Tiebreaker[]
  const move = (i: number, d: -1 | 1) => {
    const next = [...tbs]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    f.set('tiebreakers', next)
  }
  const toggle = (t: Tiebreaker) => f.set('tiebreakers', tbs.includes(t) ? tbs.filter((x) => x !== t) : [...tbs, t])
  const setType = (type: (typeof COMPETITION_TYPES)[number]) => {
    f.set('type', type)
    const knockout = type === 'knockout'
    if (knockout && f.values.rules.drawAllowed) f.set('rules', { ...(findPreset('ihf_senior_knockout') ?? f.values.rules) })
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={competition ? `Edit ${competition.name}` : 'Create competition'}
      description={competition ? 'Rule changes apply to matches created from now on. Existing matches keep their rules.' : undefined}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending || update.isPending} onClick={submit}>{competition ? 'Save changes' : 'Create competition'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-4">
          <Field label="Competition name" htmlFor="c-n" error={f.errors.name} required>
            <Input id="c-n" value={f.values.name} onChange={(e) => f.set('name', e.target.value)} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Short name" htmlFor="c-sn"><Input id="c-sn" value={f.values.shortName ?? ''} onChange={(e) => f.set('shortName', e.target.value)} /></Field>
            <Field label="Format" htmlFor="c-t">
              <Select id="c-t" value={f.values.type} onChange={(e) => setType(e.target.value as never)}>
                {COMPETITION_TYPES.map((t) => <option key={t} value={t}>{COMPETITION_TYPE_LABELS[t]}</option>)}
              </Select>
            </Field>
            <Field label="Category" htmlFor="c-cat"><Input id="c-cat" placeholder="e.g. Senior Women" value={f.values.category ?? ''} onChange={(e) => f.set('category', e.target.value)} /></Field>
            <Field label="Organiser" htmlFor="c-o"><Input id="c-o" value={f.values.organizer ?? ''} onChange={(e) => f.set('organizer', e.target.value)} /></Field>
          </div>
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">Points</div>
            <div className="grid grid-cols-3 gap-3">
              {(['pointsWin', 'pointsDraw', 'pointsLoss'] as const).map((k) => (
                <Field key={k} label={k === 'pointsWin' ? 'Win' : k === 'pointsDraw' ? 'Draw' : 'Loss'} htmlFor={`c-${k}`}>
                  <Input id={`c-${k}`} type="number" min={0} max={10} value={f.values[k]} onChange={(e) => f.set(k, Number(e.target.value))} />
                </Field>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">Tie-break order</div>
            {f.errors.tiebreakers && <p className="mb-2 text-xs text-danger">{f.errors.tiebreakers}</p>}
            <ol className="space-y-1.5">
              {tbs.map((t, i) => (
                <li key={t} className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm">
                  <span className="w-5 tabular text-faint">{i + 1}.</span>
                  <span className="flex-1">{TIEBREAKER_LABELS[t]}</span>
                  <Button size="icon-sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp /></Button>
                  <Button size="icon-sm" variant="ghost" disabled={i === tbs.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown /></Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle(t)}>Remove</Button>
                </li>
              ))}
            </ol>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TIEBREAKERS.filter((t) => !tbs.includes(t)).map((t) => (
                <Button key={t} size="sm" variant="outline" onClick={() => toggle(t)}>+ {TIEBREAKER_LABELS[t]}</Button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">Match rules</div>
          <RulesEditor value={f.values.rules} onChange={(r) => f.set('rules', r)} />
        </div>
      </div>
    </Dialog>
  )
}
