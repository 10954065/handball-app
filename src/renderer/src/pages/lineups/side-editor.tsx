import { CheckCircle2, Crown, Hand, ListChecks, Lock, Save, Sparkles, Unlock, UserMinus } from 'lucide-react'
import { toast } from 'sonner'
import type { RulesConfig } from '@shared/domain/rules'
import type { SideSetupDTO } from '@shared/dto'
import { TeamCrest } from '@/components/domain/identity'
import { PlayerCard } from '@/components/domain/player-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useApiMutation } from '@/lib/query'
import { cn } from '@/lib/cn'
import { OfficialsEditor } from './officials-editor'
import { useLineupDraft, type DraftEntry } from './use-lineup-draft'

interface Props {
  matchId: string
  side: SideSetupDTO
  rules: RulesConfig
  locked: boolean
  canEdit: boolean
}

export function SideEditor({ matchId, side, rules, locked, canEdit }: Props) {
  const d = useLineupDraft(side, rules)
  const confirmed = !!side.confirmedAt && !d.dirty
  const editable = canEdit && !locked && !side.confirmedAt
  const inv = ['lineups.', 'matches.', 'dashboard.']
  const save = useApiMutation('lineups.save', { invalidate: inv, success: `${side.teamName} match sheet saved`, onSuccess: () => d.setDirty(false) })
  const confirm = useApiMutation('lineups.confirm', { invalidate: inv, success: `${side.teamName} lineup confirmed` })
  const reopen = useApiMutation('lineups.reopen', { invalidate: inv })
  const payload = () => ({ matchId, side: side.side, entries: d.entries, officials: d.officials.filter((o) => o.name.trim()) })
  const saveAndConfirm = async () => {
    if (d.dirty || !side.entries.length) await save.mutateAsync(payload())
    confirm.mutate({ matchId, side: side.side })
  }

  const card = (e: DraftEntry, size: 'lg' | 'sm') => {
    const p = d.squad.get(e.playerId)
    if (!p) return null
    return (
      <PlayerCard
        key={e.playerId}
        name={p.fullName}
        jersey={e.jerseyNumber}
        position={p.position}
        photoMediaId={p.photoMediaId}
        color={side.color}
        captain={e.isCaptain}
        goalkeeper={e.isStartingGk || (size === 'sm' && p.isGoalkeeper)}
        selected={e.isStarting}
        onClick={editable ? () => d.toggleStart(e.playerId) === 'full' && toast.warning(`The starting seven is full. Move a starter to the bench first.`) : undefined}
        className={cn(size === 'sm' && '[&_img]:size-12')}
        footer={
          editable && (
            <div className="flex gap-1" onClick={(ev) => ev.stopPropagation()}>
              {e.isStarting && (
                <Button size="sm" variant={e.isStartingGk ? 'subtle' : 'ghost'} className="h-7 flex-1 px-1.5" title="Starting goalkeeper" onClick={() => d.setGk(e.playerId)}>
                  <Hand /> GK
                </Button>
              )}
              <Button size="sm" variant={e.isCaptain ? 'subtle' : 'ghost'} className="h-7 flex-1 px-1.5" title="Captain" onClick={() => d.setCaptain(e.playerId)}>
                <Crown /> C
              </Button>
              {!e.isStarting && (
                <Button size="sm" variant="ghost" className="h-7 px-1.5" title="Remove from match sheet" aria-label={`Remove ${p.fullName}`} onClick={() => d.remove(e.playerId)}>
                  <UserMinus />
                </Button>
              )}
            </div>
          )
        }
      />
    )
  }

  const starters = d.entries.filter((e) => e.isStarting).sort((a, b) => Number(b.isStartingGk) - Number(a.isStartingGk) || a.jerseyNumber - b.jerseyNumber)
  const subs = d.entries.filter((e) => !e.isStarting).sort((a, b) => a.jerseyNumber - b.jerseyNumber)
  const pool = side.squad.filter((p) => !d.has(p.playerId))
  const gk = d.entries.find((e) => e.isStartingGk)
  const captain = d.entries.find((e) => e.isCaptain)

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-surface-1" aria-label={`${side.teamName} lineup`}>
      <header className="relative overflow-hidden rounded-t-2xl border-b border-border px-5 py-4">
        <div className="absolute inset-0 opacity-15" style={{ background: `linear-gradient(100deg, ${side.color}, transparent 70%)` }} />
        <div className="relative flex items-center gap-4">
          <TeamCrest logoMediaId={side.logoMediaId} code={side.code} color={side.color} size={52} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{side.side === 'home' ? 'Home' : 'Away'}</div>
            <div className="truncate font-display text-2xl font-bold tracking-wide">{side.teamName}</div>
          </div>
          {confirmed ? (
            <Badge tone="success" className="px-2 py-1"><CheckCircle2 className="size-3.5" /> Confirmed</Badge>
          ) : side.entries.length ? (
            <Badge tone="warning" className="px-2 py-1">{d.dirty ? 'Unsaved changes' : 'Draft'}</Badge>
          ) : (
            <Badge className="px-2 py-1">{d.dirty ? 'Unsaved changes' : 'Not prepared'}</Badge>
          )}
        </div>
        <div className="relative mt-3 flex flex-wrap gap-2 text-xs">
          <Counter label="Starters" value={`${d.starters.length}/${rules.roster.onCourt}`} ok={d.starters.length === rules.roster.onCourt} />
          <Counter label="Match sheet" value={`${d.entries.length}/${rules.roster.maxPlayers}`} ok={d.entries.length > 0} />
          <Counter label="Goalkeeper" value={gk ? `#${gk.jerseyNumber}` : '-'} ok={!!gk} />
          <Counter label="Captain" value={captain ? `#${captain.jerseyNumber}` : '-'} ok={!!captain} />
        </div>
      </header>

      {editable && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5">
          <Button size="sm" variant="ghost" onClick={d.selectSquad}><ListChecks /> Add whole squad</Button>
          <Button size="sm" variant="ghost" disabled={!d.entries.length} onClick={d.suggestSeven}><Sparkles /> Suggest seven</Button>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" disabled={!d.dirty} loading={save.isPending} onClick={() => save.mutate(payload())}><Save /> Save draft</Button>
            <Button size="sm" variant="success" disabled={d.validation.errors.length > 0} loading={confirm.isPending} onClick={() => void saveAndConfirm()}><CheckCircle2 /> Confirm lineup</Button>
          </div>
        </div>
      )}
      {canEdit && !locked && side.confirmedAt && (
        <div className="flex items-center gap-3 border-b border-border px-5 py-2.5 text-sm text-muted">
          <Lock className="size-4 text-goal" /> Confirmed by {side.confirmedBy ?? 'unknown'}
          <Button size="sm" variant="ghost" className="ml-auto" loading={reopen.isPending} onClick={() => reopen.mutate({ matchId, side: side.side })}><Unlock /> Reopen for changes</Button>
        </div>
      )}

      {(d.validation.errors.length > 0 || d.validation.warnings.length > 0) && d.entries.length > 0 && (
        <ul className="space-y-1 border-b border-border px-5 py-2.5 text-xs">
          {d.validation.errors.map((e) => <li key={e} className="text-danger">{e}</li>)}
          {d.validation.warnings.map((w) => <li key={w} className="text-warning">{w}</li>)}
        </ul>
      )}

      <div className="space-y-5 p-5">
        <div>
          <SectionTitle title="Starting seven" hint={editable ? 'Click a starter to move them to the bench.' : undefined} />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-4">
            {starters.map((e) => card(e, 'lg'))}
            {Array.from({ length: Math.max(0, rules.roster.onCourt - starters.length) }, (_, i) => (
              <div key={`empty-${i}`} className="grid min-h-[132px] place-items-center rounded-xl border border-dashed border-border-strong text-xs text-faint">
                {i === 0 && !gk ? 'Goalkeeper' : 'Open slot'}
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionTitle title={`Substitutes (${subs.length})`} hint={editable ? 'Click a substitute to put them in the starting seven.' : undefined} />
          {subs.length ? <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 2xl:grid-cols-5">{subs.map((e) => card(e, 'sm'))}</div> : <p className="text-sm text-faint">No substitutes on the match sheet.</p>}
        </div>
        {editable && (
          <div>
            <SectionTitle title={`Squad - not selected (${pool.length})`} hint="Click a player to add them to the match sheet." />
            <div className="flex flex-wrap gap-2">
              {pool.map((p) => (
                <button
                  key={p.playerId}
                  disabled={!p.eligible}
                  title={p.ineligibleReason ?? `Add ${p.fullName}`}
                  onClick={() => !d.add(p) && toast.warning(`The match sheet is limited to ${rules.roster.maxPlayers} players.`)}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 py-1.5 pl-1.5 pr-3 text-left text-sm hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="grid h-7 min-w-7 place-items-center rounded-md font-display font-bold" style={{ background: side.color }}>{p.jerseyNumber}</span>
                  <span className="truncate">{p.fullName}</span>
                  {!p.eligible && <span className="text-[10px] text-danger">{p.ineligibleReason}</span>}
                </button>
              ))}
              {!pool.length && <p className="text-sm text-faint">All registered players are on the match sheet.</p>}
            </div>
          </div>
        )}
        <OfficialsEditor officials={d.officials} onChange={d.setOfficials} disabled={!editable} max={rules.roster.maxOfficials} />
      </div>
    </section>
  )
}

function Counter({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <span className={cn('rounded-md border px-2 py-1', ok ? 'border-goal/30 bg-goal/10 text-text' : 'border-border bg-surface-2 text-muted')}>
      <span className="text-muted">{label}</span> <span className="font-semibold tabular">{value}</span>
    </span>
  )
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </div>
  )
}
