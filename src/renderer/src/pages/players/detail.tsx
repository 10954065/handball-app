import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Archive, ArrowLeft, ArrowRightLeft, Hash, Pencil } from 'lucide-react'
import { POSITION_LABELS } from '@shared/domain/constants'
import type { PlayerDetailDTO } from '@shared/dto'
import { Page } from '@/components/layout/shell'
import { contrastOn, PlayerAvatar } from '@/components/domain/identity'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm'
import { ErrorNote, Panel, PanelHeader, Spinner, Stat } from '@/components/ui/misc'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { ageFrom, fmtDate, pct } from '@/lib/format'
import { useApi, useApiMutation } from '@/lib/query'
import { useSession } from '@/lib/session'
import { PlayerFormDialog } from './player-form'
import { JerseyDialog, TransferDialog } from './transfer'

export function PlayerDetailPage() {
  const { id = '' } = useParams()
  const { can } = useSession()
  const confirm = useConfirm()
  const q = useApi('players.get', { id })
  const [dialog, setDialog] = useState<'edit' | 'transfer' | 'jersey' | null>(null)
  const archive = useApiMutation('players.archive', { invalidate: ['players.', 'teams.'] })
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <Page><ErrorNote error={q.error} /></Page>
  const p = q.data
  const color = p.teamColor ?? '#31416a'
  const manage = can('manage_data')

  return (
    <Page>
      <Link to="/players" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Players
      </Link>
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-surface-1">
        <div className="absolute inset-0 opacity-20" style={{ background: `linear-gradient(110deg, ${color} 0%, transparent 60%)` }} />
        <div className="relative flex flex-wrap items-center gap-7 p-7">
          <PlayerAvatar photoMediaId={p.photoMediaId} name={p.fullName} size={132} rounded="lg" className="ring-2 ring-white/10" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 text-sm text-muted">
              <span className="font-mono">{p.registrationNo}</span>
              {p.isCaptain && <Badge tone="gold">Captain</Badge>}
              {p.isGoalkeeper && <Badge tone="primary">Goalkeeper</Badge>}
              <Badge tone={p.registrationStatus === 'registered' ? 'success' : 'warning'}>{p.registrationStatus}</Badge>
              {p.archived && <Badge>Archived</Badge>}
            </div>
            <h1 className="mt-2 font-display text-5xl font-bold tracking-wide">{p.fullName}</h1>
            <p className="mt-2 text-base text-muted">
              {p.position ? POSITION_LABELS[p.position] : 'Position not specified'} {p.teamName ? ` - ${p.teamName}` : ' - Free agent'}
            </p>
          </div>
          <div className="grid size-32 place-items-center rounded-2xl font-display text-7xl font-bold tabular" style={{ background: color, color: contrastOn(color) }}>
            {p.jerseyNumber ?? '-'}
          </div>
        </div>
        {manage && (
          <div className="relative flex gap-2 border-t border-border px-7 py-3">
            <Button size="sm" variant="secondary" onClick={() => setDialog('edit')}><Pencil /> Edit details</Button>
            <Button size="sm" variant="secondary" onClick={() => setDialog('transfer')}><ArrowRightLeft /> Transfer</Button>
            <Button size="sm" variant="secondary" disabled={!p.teamId} onClick={() => setDialog('jersey')}><Hash /> Change jersey</Button>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={async () => {
                if (await confirm({ title: p.archived ? 'Restore player?' : 'Archive player?', message: 'Match history and statistics are always kept.', confirmLabel: p.archived ? 'Restore' : 'Archive' })) {
                  archive.mutate({ id: p.id, archived: !p.archived })
                }
              }}
            >
              <Archive /> {p.archived ? 'Restore' : 'Archive'}
            </Button>
          </div>
        )}
      </div>
      <PlayerBody player={p} />
      {dialog === 'edit' && <PlayerFormDialog player={p} onClose={() => setDialog(null)} />}
      {dialog === 'transfer' && <TransferDialog player={p} onClose={() => setDialog(null)} />}
      {dialog === 'jersey' && <JerseyDialog player={p} onClose={() => setDialog(null)} />}
    </Page>
  )
}

function PlayerBody({ player: p }: { player: PlayerDetailDTO }) {
  const t = p.totals
  const details: [string, string][] = [
    ['Date of birth', p.dateOfBirth ? `${fmtDate(Date.parse(p.dateOfBirth))} (age ${ageFrom(p.dateOfBirth)})` : '-'],
    ['Gender', p.gender ?? '-'],
    ['Nationality', p.nationality ?? '-'],
    ['Height', p.heightCm ? `${p.heightCm} cm` : '-'],
    ['Competitions', p.competitions.join(', ') || '-']
  ]
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Matches" value={t.matches} />
        <Stat label="Goals" value={t.goals} accent="text-goal" hint={`${t.sevenMetreGoals} from 7 m`} />
        <Stat label="Shooting" value={pct(t.goals, t.shots)} hint={`${t.goals}/${t.shots} shots`} />
        <Stat label="Assists" value={t.assists} />
        <Stat label="Warnings" value={t.warnings} accent="text-yellow-card" />
        <Stat label="2-min" value={t.suspensions} accent="text-suspension" />
        <Stat label="Disqualified" value={t.disqualifications} accent="text-red-card" />
        {p.isGoalkeeper ? <Stat label="Saves" value={t.saves} hint={`${pct(t.saves, t.shotsFaced)} save rate`} /> : <Stat label="Steals" value={t.steals} hint={`${t.turnovers} turnovers`} />}
      </div>
      <p className="text-xs text-faint">All statistics are calculated from the recorded match event ledger.</p>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Personal details" />
            <dl className="divide-y divide-border">
              {details.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-5 py-2.5 text-sm">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right capitalize">{v}</dd>
                </div>
              ))}
            </dl>
            {p.notes && <p className="border-t border-border px-5 py-3 text-sm text-muted">{p.notes}</p>}
          </Panel>
          <Panel>
            <PanelHeader title="Registration history" />
            <ul className="divide-y divide-border">
              {p.history.length === 0 && <li className="px-5 py-3 text-sm text-muted">Never registered with a team.</li>}
              {p.history.map((h) => (
                <li key={h.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span>
                    <Link to={`/teams/${h.teamId}`} className="font-medium hover:text-primary">{h.teamName}</Link> <span className="text-muted">#{h.jerseyNumber}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {fmtDate(h.joinedAt)} - {h.leftAt ? fmtDate(h.leftAt) : <Badge tone="success">Current</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <Panel>
          <PanelHeader title="Match history and discipline" />
          {p.matches.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">No matches yet. Matches appear here once the player is entered on a match sheet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Match</Th>
                  <Th>#</Th>
                  <Th className="text-right">Goals</Th>
                  <Th className="text-right">Shots</Th>
                  <Th className="text-right">Yellow</Th>
                  <Th className="text-right">2 min</Th>
                  <Th className="text-right">Red</Th>
                </tr>
              </thead>
              <tbody>
                {p.matches.map((m) => (
                  <Tr key={m.matchId}>
                    <Td className="tabular text-muted">{fmtDate(m.scheduledAt)}</Td>
                    <Td>
                      <Link to={`/matches/${m.matchId}`} className="hover:text-primary">
                        {m.teamName} vs {m.opponentName}
                      </Link>
                      {m.isStarting && <Badge className="ml-2">Starter</Badge>}
                    </Td>
                    <Td className="tabular">{m.jerseyNumber}</Td>
                    <Td className="text-right font-semibold tabular text-goal">{m.goals}</Td>
                    <Td className="text-right tabular">{m.shots}</Td>
                    <Td className="text-right tabular">{m.warnings || ''}</Td>
                    <Td className="text-right tabular">{m.suspensions || ''}</Td>
                    <Td className="text-right tabular">{m.disqualifications || ''}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </div>
  )
}
