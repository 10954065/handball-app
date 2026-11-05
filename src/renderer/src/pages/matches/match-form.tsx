import { useMemo, useState } from 'react'
import { MATCH_STAGE_LABELS, MATCH_STAGES, type MatchStage } from '@shared/domain/constants'
import { DEFAULT_RULES, type RulesConfig } from '@shared/domain/rules'
import { RulesEditor } from '@/components/domain/rules-editor'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { numOrNull } from '@/lib/form'
import { useApi, useApiMutation } from '@/lib/query'
import { OfficialsPicker, type AssignedOfficial } from './officials-picker'

interface Props {
  competitionId?: string
  seasonId?: string
  onClose: () => void
  onCreated?: (id: string) => void
}

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function MatchFormDialog({ competitionId: initialComp, seasonId: initialSeason, onClose, onCreated }: Props) {
  const teams = useApi('teams.list')
  const comps = useApi('competitions.list')
  const venues = useApi('venues.list')
  const officials = useApi('officials.list')
  const [homeTeamId, setHome] = useState('')
  const [awayTeamId, setAway] = useState('')
  const [competitionId, setComp] = useState(initialComp ?? '')
  const [seasonId, setSeason] = useState(initialSeason ?? '')
  const [stage, setStage] = useState<MatchStage>('league')
  const [round, setRound] = useState<number | null>(null)
  const [groupName, setGroup] = useState('')
  const [date, setDate] = useState(localDate(new Date()))
  const [time, setTime] = useState('16:00')
  const [venueId, setVenue] = useState('')
  const [assigned, setAssigned] = useState<AssignedOfficial[]>([])
  const [customRules, setCustomRules] = useState(false)
  const [rules, setRules] = useState<RulesConfig>(DEFAULT_RULES)
  const [error, setError] = useState<string | null>(null)

  const comp = comps.data?.find((c) => c.id === competitionId)
  const season = comp?.seasons.find((s) => s.id === seasonId)
  const allowedTeams = useMemo(() => {
    if (!season || season.teams.length === 0) return teams.data ?? []
    const ids = new Set(season.teams.map((t) => t.teamId))
    return (teams.data ?? []).filter((t) => ids.has(t.id))
  }, [season, teams.data])
  const effectiveRules = customRules ? rules : comp?.rules
  const create = useApiMutation('matches.create', {
    invalidate: ['matches.', 'dashboard.', 'competitions.', 'officials.'],
    success: (m) => `Match ${m.matchNumber} created`,
    onSuccess: (m) => {
      onCreated?.(m.id)
      onClose()
    }
  })
  const submit = () => {
    setError(null)
    if (!homeTeamId || !awayTeamId) return setError('Select both teams.')
    if (homeTeamId === awayTeamId) return setError('A team cannot play itself.')
    const scheduledAt = new Date(`${date}T${time || '00:00'}`).getTime()
    if (Number.isNaN(scheduledAt)) return setError('Enter a valid date and time.')
    create.mutate({
      homeTeamId,
      awayTeamId,
      competitionId: competitionId || null,
      seasonId: seasonId || null,
      venueId: venueId || null,
      scheduledAt,
      stage: competitionId ? stage : 'friendly',
      round,
      groupName: groupName || null,
      rules: customRules ? rules : undefined,
      officials: assigned.filter((a) => a.officialId)
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create match"
      description="Rules and team details are saved with the match when it is created."
      size="xl"
      footer={
        <>
          {error && <span className="mr-auto text-sm text-danger">{error}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} onClick={submit}>Create match</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Competition" htmlFor="m-c">
              <Select id="m-c" value={competitionId} onChange={(e) => { setComp(e.target.value); setSeason('') }}>
                <option value="">Friendly / no competition</option>
                {comps.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Season" htmlFor="m-s">
              <Select id="m-s" value={seasonId} disabled={!comp} onChange={(e) => setSeason(e.target.value)}>
                <option value="">{comp ? 'No season' : '-'}</option>
                {comp?.seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Home team" htmlFor="m-h" required>
              <Select id="m-h" value={homeTeamId} onChange={(e) => setHome(e.target.value)}>
                <option value="">Select team</option>
                {allowedTeams.map((t) => <option key={t.id} value={t.id} disabled={t.id === awayTeamId}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="Away team" htmlFor="m-a" required>
              <Select id="m-a" value={awayTeamId} onChange={(e) => setAway(e.target.value)}>
                <option value="">Select team</option>
                {allowedTeams.map((t) => <option key={t.id} value={t.id} disabled={t.id === homeTeamId}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="Date" htmlFor="m-d"><Input id="m-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Throw-off time" htmlFor="m-t"><Input id="m-t" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
            <Field label="Venue" htmlFor="m-v" className="col-span-2">
              <Select id="m-v" value={venueId} onChange={(e) => setVenue(e.target.value)}>
                <option value="">Not specified</option>
                {venues.data?.map((v) => <option key={v.id} value={v.id}>{v.name}{v.city ? `, ${v.city}` : ''}</option>)}
              </Select>
            </Field>
            {comp && (
              <>
                <Field label="Stage" htmlFor="m-st">
                  <Select id="m-st" value={stage} onChange={(e) => setStage(e.target.value as MatchStage)}>
                    {MATCH_STAGES.filter((s) => s !== 'friendly').map((s) => <option key={s} value={s}>{MATCH_STAGE_LABELS[s]}</option>)}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Round" htmlFor="m-r"><Input id="m-r" type="number" min={1} value={round ?? ''} onChange={(e) => setRound(numOrNull(e.target.value))} /></Field>
                  <Field label="Group" htmlFor="m-g"><Input id="m-g" maxLength={3} value={groupName} onChange={(e) => setGroup(e.target.value.toUpperCase())} /></Field>
                </div>
              </>
            )}
          </div>
          <OfficialsPicker assigned={assigned} setAssigned={setAssigned} options={officials.data ?? []} />
        </div>
        <div className="space-y-3">
          <div className="text-[12px] font-semibold uppercase tracking-wider text-muted">Match rules</div>
          <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm">
            {effectiveRules ? (
              <>
                {effectiveRules.presetName}
                <span className="text-muted"> - 2 x {effectiveRules.periodMinutes} min, {effectiveRules.drawAllowed ? 'draw allowed' : 'winner required'}</span>
              </>
            ) : (
              'Default rules from Settings'
            )}
          </div>
          <Switch label="Use custom rules for this match" checked={customRules} onCheckedChange={(v) => { setCustomRules(v); if (v && comp) setRules(comp.rules) }} />
          {customRules && <RulesEditor value={rules} onChange={setRules} />}
        </div>
      </div>
    </Dialog>
  )
}
