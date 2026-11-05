import { useState } from 'react'
import type { SeasonDTO } from '@shared/dto'
import { TeamCrest } from '@/components/domain/identity'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useApi, useApiMutation } from '@/lib/query'

/** Register teams in a season, optionally assigning groups. */
export function SeasonTeamsDialog({ season, grouped, onClose }: { season: SeasonDTO; grouped: boolean; onClose: () => void }) {
  const teams = useApi('teams.list')
  const [sel, setSel] = useState<Map<string, string>>(new Map(season.teams.map((t) => [t.teamId, t.groupName ?? ''])))
  const save = useApiMutation('seasons.setTeams', { invalidate: ['competitions.', 'teams.', 'seasons.'], success: 'Season teams updated', onSuccess: onClose })
  const toggle = (id: string) => {
    const next = new Map(sel)
    if (next.has(id)) next.delete(id)
    else next.set(id, '')
    setSel(next)
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Teams in ${season.name}`}
      description={grouped ? 'Select teams and assign each to a group (e.g. A, B).' : 'Select the teams taking part.'}
      size="lg"
      footer={
        <>
          <span className="mr-auto text-sm text-muted">{sel.size} selected</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate({ seasonId: season.id, teams: [...sel.entries()].map(([teamId, groupName]) => ({ teamId, groupName: groupName || null })) })}>Save</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {teams.data?.map((t) => {
          const on = sel.has(t.id)
          return (
            <div key={t.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${on ? 'border-primary bg-primary/8' : 'border-border'}`}>
              <button className="flex flex-1 items-center gap-3 text-left" onClick={() => toggle(t.id)} aria-pressed={on}>
                <input type="checkbox" readOnly checked={on} className="size-4 accent-[var(--primary)]" tabIndex={-1} />
                <TeamCrest logoMediaId={t.logoMediaId} code={t.code} color={t.primaryColor} size={30} />
                <span className="text-sm font-medium">{t.name}</span>
              </button>
              {grouped && on && (
                <Input
                  aria-label={`Group for ${t.name}`}
                  className="h-8 w-16 text-center uppercase"
                  maxLength={3}
                  value={sel.get(t.id) ?? ''}
                  onChange={(e) => setSel(new Map(sel).set(t.id, e.target.value.toUpperCase()))}
                  placeholder="Grp"
                />
              )}
            </div>
          )
        })}
      </div>
    </Dialog>
  )
}
