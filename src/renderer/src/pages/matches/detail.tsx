import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { Page } from '@/components/layout/shell'
import { MatchHeader } from '@/components/domain/match-header'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm'
import { ErrorNote, Panel, PanelHeader, Spinner } from '@/components/ui/misc'
import { useApi, useApiMutation } from '@/lib/query'
import { useSession } from '@/lib/session'
import { EditMatchDialog } from './edit-match'

export function MatchDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { can } = useSession()
  const q = useApi('matches.get', { id })
  const [editing, setEditing] = useState(false)
  const del = useApiMutation('matches.delete', {
    invalidate: ['matches.', 'dashboard.', 'competitions.'],
    success: 'Match deleted',
    onSuccess: () => navigate('/matches')
  })
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <Page><ErrorNote error={q.error} /></Page>
  const m = q.data
  const editable = m.status === 'scheduled' || m.status === 'ready'
  const r = m.rules
  const remove = async () => {
    const ok = await confirm({ title: 'Delete this fixture?', message: 'Only fixtures that have not started can be deleted.', confirmLabel: 'Delete', tone: 'danger' })
    if (ok) del.mutate({ id: m.id })
  }

  return (
    <Page>
      <Link to="/matches" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Matches
      </Link>
      <MatchHeader
        m={m}
        actions={
          can('manage_data') &&
          editable && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil /> Edit schedule & officials</Button>
              <Button size="sm" variant="ghost" className="ml-auto text-danger" onClick={() => void remove()}><Trash2 /> Delete fixture</Button>
            </>
          )
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Match officials" />
          {m.officials.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">No officials assigned.</p>
          ) : (
            <ul className="divide-y divide-border">
              {m.officials.map((o) => (
                <li key={o.officialId + o.role} className="flex justify-between px-5 py-2.5 text-sm">
                  <span className="font-medium">{o.name}</span>
                  <span className="text-muted">{o.role}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Rules for this match" subtitle="Saved with the match when it was created." />
          <dl className="grid grid-cols-[160px_1fr] gap-x-6 gap-y-2 px-5 py-4 text-sm">
            <dt className="text-muted">Preset</dt>
            <dd>{r.presetName}</dd>
            <dt className="text-muted">Playing time</dt>
            <dd>2 x {r.periodMinutes} min, half-time {r.halfTimeBreakMinutes} min</dd>
            <dt className="text-muted">Result</dt>
            <dd>{r.drawAllowed ? 'Draw allowed' : 'Winner required'}</dd>
            <dt className="text-muted">Overtime</dt>
            <dd>{r.overtime.enabled ? `Up to ${r.overtime.maxOvertimes} x 2 x ${r.overtime.periodMinutes} min` : 'None'}</dd>
            <dt className="text-muted">Shoot-out</dt>
            <dd>{r.shootout.enabled ? `${r.shootout.throwsPerTeam} throws per team` : 'None'}</dd>
            <dt className="text-muted">Team time-outs</dt>
            <dd>{r.timeouts.perMatch} per match, {r.timeouts.durationSeconds} s</dd>
            <dt className="text-muted">Suspension</dt>
            <dd>{r.suspension.durationSeconds} s; disqualification on suspension {r.suspension.disqualifyOnSuspensionNumber}</dd>
          </dl>
        </Panel>
      </div>
      {editing && <EditMatchDialog match={m} onClose={() => setEditing(false)} />}
    </Page>
  )
}
