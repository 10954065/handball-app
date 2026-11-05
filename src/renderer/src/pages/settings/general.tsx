import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { RULE_PRESETS } from '@shared/domain/rules'
import type { AppSettings } from '@shared/dto'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { Panel, PanelHeader, Spinner } from '@/components/ui/misc'
import { Switch } from '@/components/ui/switch'
import { useApi, useApiMutation } from '@/lib/query'
import { useSession } from '@/lib/session'

export function GeneralSettings() {
  const settings = useApi('settings.get')
  const { can } = useSession()
  const [draft, setDraft] = useState<AppSettings | null>(null)
  useEffect(() => {
    if (settings.data) setDraft(settings.data)
  }, [settings.data])
  const save = useApiMutation('settings.update', { invalidate: ['settings.'], success: 'Settings saved' })

  if (!draft) return <Spinner />
  const admin = can('admin')
  const patch = <K extends keyof AppSettings>(k: K, v: Partial<AppSettings[K]> | AppSettings[K]) =>
    setDraft({ ...draft, [k]: typeof v === 'object' && v !== null ? { ...(draft[k] as object), ...v } : v })

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Panel>
        <PanelHeader title="Organisation" />
        <div className="space-y-4 p-5">
          <Field label="Association / organisation name" htmlFor="org">
            <Input id="org" value={draft.organisationName} disabled={!admin} onChange={(e) => patch('organisationName', e.target.value)} />
          </Field>
          <Field label="Default match rules" htmlFor="preset" hint="Used when creating a match without a competition.">
            <Select id="preset" value={draft.defaultRulesPresetId} disabled={!admin} onChange={(e) => patch('defaultRulesPresetId', e.target.value)}>
              {RULE_PRESETS.map((p) => (
                <option key={p.presetId} value={p.presetId}>
                  {p.presetName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Theme" htmlFor="theme">
            <Select
              id="theme"
              value={draft.display.theme}
              disabled={!admin}
              onChange={(e) => patch('display', { theme: e.target.value as AppSettings['display']['theme'] })}
            >
              <option value="dark">Dark - control room</option>
              <option value="light">Light - administration</option>
              <option value="system">Follow Windows</option>
            </Select>
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Live match operation" />
        <div className="divide-y divide-border px-5 py-2">
          <Switch
            label="Advanced statistics controls"
            description="Missed / saved shots, steals, turnovers, technical faults and blocks."
            checked={draft.live.advancedStats}
            disabled={!admin}
            onCheckedChange={(v) => patch('live', { advancedStats: v })}
          />
          <Switch
            label="Ask for assist after each goal"
            checked={draft.live.assistPrompt}
            disabled={!admin}
            onCheckedChange={(v) => patch('live', { assistPrompt: v })}
          />
          <Switch
            label="Track court presence"
            description="Maintain the active seven through substitutions."
            checked={draft.live.trackCourtPresence}
            disabled={!admin}
            onCheckedChange={(v) => patch('live', { trackCourtPresence: v })}
          />
          <Switch
            label="Confirm critical actions"
            description="Period ends, match end and corrections require confirmation."
            checked={draft.live.confirmCriticalActions}
            disabled={!admin}
            onCheckedChange={(v) => patch('live', { confirmCriticalActions: v })}
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Sound" />
        <div className="divide-y divide-border px-5 py-2">
          <Switch label="Sound notifications" checked={draft.sound.enabled} disabled={!admin} onCheckedChange={(v) => patch('sound', { enabled: v })} />
          <Switch label="Suspension expired" checked={draft.sound.suspensionExpiry} disabled={!admin || !draft.sound.enabled} onCheckedChange={(v) => patch('sound', { suspensionExpiry: v })} />
          <Switch label="Time-out ending" checked={draft.sound.timeoutEnd} disabled={!admin || !draft.sound.enabled} onCheckedChange={(v) => patch('sound', { timeoutEnd: v })} />
          <Switch label="Period time expired" checked={draft.sound.periodEnd} disabled={!admin || !draft.sound.enabled} onCheckedChange={(v) => patch('sound', { periodEnd: v })} />
          <div className="py-3">
            <Field label={`Volume ${Math.round(draft.sound.volume * 100)}%`} htmlFor="vol">
              <input
                id="vol"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={draft.sound.volume}
                disabled={!admin}
                onChange={(e) => patch('sound', { volume: Number(e.target.value) })}
                className="accent-[var(--primary)]"
              />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Automatic backup" />
        <div className="space-y-2 px-5 py-2">
          <Switch label="Automatic backups" checked={draft.backup.autoEnabled} disabled={!admin} onCheckedChange={(v) => patch('backup', { autoEnabled: v })} />
          <Switch label="Back up when a match is finalized" checked={draft.backup.onMatchFinalize} disabled={!admin} onCheckedChange={(v) => patch('backup', { onMatchFinalize: v })} />
          <div className="grid grid-cols-2 gap-3 pb-3">
            <Field label="Interval (minutes)" htmlFor="int">
              <Input id="int" type="number" min={5} max={1440} value={draft.backup.intervalMinutes} disabled={!admin} onChange={(e) => patch('backup', { intervalMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Keep automatic backups" htmlFor="keep">
              <Input id="keep" type="number" min={3} max={200} value={draft.backup.keep} disabled={!admin} onChange={(e) => patch('backup', { keep: Number(e.target.value) })} />
            </Field>
          </div>
        </div>
      </Panel>

      {admin && (
        <div className="xl:col-span-2 flex justify-end">
          <Button loading={save.isPending} onClick={() => save.mutate(draft)}>
            <Save /> Save settings
          </Button>
        </div>
      )}
    </div>
  )
}
