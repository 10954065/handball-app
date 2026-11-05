import { RULE_PRESETS, type RulesConfig } from '@shared/domain/rules'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

interface Props {
  value: RulesConfig
  onChange: (r: RulesConfig) => void
  disabled?: boolean
}

/** Edit a competition rule configuration, starting from an IHF preset. */
export function RulesEditor({ value: r, onChange, disabled }: Props) {
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== '' ? Math.round(Number(v)) : fallback)
  const setPreset = (id: string) => {
    const p = RULE_PRESETS.find((x) => x.presetId === id)
    if (p) onChange(p)
  }
  return (
    <div className="space-y-4">
      <Field label="Rule preset" htmlFor="r-preset" hint="Values below can be adjusted to the competition regulations.">
        <Select id="r-preset" value={RULE_PRESETS.some((p) => p.presetId === r.presetId) ? r.presetId : ''} onChange={(e) => setPreset(e.target.value)} disabled={disabled}>
          {!RULE_PRESETS.some((p) => p.presetId === r.presetId) && <option value="">{r.presetName}</option>}
          {RULE_PRESETS.map((p) => (
            <option key={p.presetId} value={p.presetId}>{p.presetName}</option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-4 gap-3">
        <Field label="Half length (min)" htmlFor="r-pm">
          <Input id="r-pm" type="number" disabled={disabled} value={r.periodMinutes} onChange={(e) => onChange({ ...r, periodMinutes: num(e.target.value, r.periodMinutes), presetName: 'Custom' })} />
        </Field>
        <Field label="Half-time (min)" htmlFor="r-ht">
          <Input id="r-ht" type="number" disabled={disabled} value={r.halfTimeBreakMinutes} onChange={(e) => onChange({ ...r, halfTimeBreakMinutes: num(e.target.value, r.halfTimeBreakMinutes) })} />
        </Field>
        <Field label="Time-outs / match" htmlFor="r-to">
          <Input id="r-to" type="number" disabled={disabled} value={r.timeouts.perMatch} onChange={(e) => onChange({ ...r, timeouts: { ...r.timeouts, perMatch: num(e.target.value, r.timeouts.perMatch) } })} />
        </Field>
        <Field label="Time-out (s)" htmlFor="r-tod">
          <Input id="r-tod" type="number" disabled={disabled} value={r.timeouts.durationSeconds} onChange={(e) => onChange({ ...r, timeouts: { ...r.timeouts, durationSeconds: num(e.target.value, r.timeouts.durationSeconds) } })} />
        </Field>
        <Field label="Suspension (s)" htmlFor="r-su">
          <Input id="r-su" type="number" disabled={disabled} value={r.suspension.durationSeconds} onChange={(e) => onChange({ ...r, suspension: { ...r.suspension, durationSeconds: num(e.target.value, r.suspension.durationSeconds) } })} />
        </Field>
        <Field label="Max players / sheet" htmlFor="r-mp">
          <Input id="r-mp" type="number" disabled={disabled} value={r.roster.maxPlayers} onChange={(e) => onChange({ ...r, roster: { ...r.roster, maxPlayers: num(e.target.value, r.roster.maxPlayers) } })} />
        </Field>
        <Field label="Overtime half (min)" htmlFor="r-ot">
          <Input id="r-ot" type="number" disabled={disabled || !r.overtime.enabled} value={r.overtime.periodMinutes} onChange={(e) => onChange({ ...r, overtime: { ...r.overtime, periodMinutes: num(e.target.value, r.overtime.periodMinutes) } })} />
        </Field>
        <Field label="Shoot-out throws" htmlFor="r-ps">
          <Input id="r-ps" type="number" disabled={disabled || !r.shootout.enabled} value={r.shootout.throwsPerTeam} onChange={(e) => onChange({ ...r, shootout: { ...r.shootout, throwsPerTeam: num(e.target.value, r.shootout.throwsPerTeam) } })} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-x-6 rounded-lg border border-border px-4">
        <Switch label="Draw is a valid result" description="Off: a winner is required" disabled={disabled} checked={r.drawAllowed} onCheckedChange={(v) => onChange({ ...r, drawAllowed: v })} />
        <Switch label="Overtime" description={`${r.overtime.maxOvertimes} x (2 x ${r.overtime.periodMinutes} min)`} disabled={disabled} checked={r.overtime.enabled} onCheckedChange={(v) => onChange({ ...r, overtime: { ...r.overtime, enabled: v } })} />
        <Switch label="Penalty shoot-out" disabled={disabled} checked={r.shootout.enabled} onCheckedChange={(v) => onChange({ ...r, shootout: { ...r.shootout, enabled: v } })} />
      </div>
    </div>
  )
}
