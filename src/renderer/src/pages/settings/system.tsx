import { FileWarning, FolderOpen, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, Panel, PanelHeader, Spinner } from '@/components/ui/misc'
import { call } from '@/lib/api'
import { fmtDateTime } from '@/lib/format'
import { useApi } from '@/lib/query'
import { useSession } from '@/lib/session'

export function SystemSettings() {
  const info = useApi('app.info')
  const { can } = useSession()
  if (!info.data) return <Spinner />
  const i = info.data
  const rows: [string, string][] = [
    ['Version', i.version],
    ['Data mode', i.mode === 'demo' ? 'Demonstration (sample data)' : 'Production'],
    ['Database file', i.dbFile],
    ['Backup folder', i.backupDir],
    ['Log folder', i.logDir],
    ['SQLite', i.sqlite],
    ['Electron / Chromium / Node', `${i.electron} / ${i.chrome} / ${i.node}`],
    ['Platform', i.platform]
  ]
  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="System information"
          subtitle="HMMS works fully offline. All data is stored locally in the folders below."
          actions={
            <>
              <Button size="sm" variant="secondary" onClick={() => void call('app.openLogFolder')}>
                <FileWarning /> Open log folder
              </Button>
              {can('admin') && (
                <Button size="sm" variant="secondary" onClick={() => void call('app.openDataFolder')}>
                  <FolderOpen /> Open data folder
                </Button>
              )}
            </>
          }
        />
        <dl className="divide-y divide-border">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[240px_1fr] gap-4 px-5 py-2.5 text-sm">
              <dt className="text-muted">{k}</dt>
              <dd className="break-all font-mono text-xs leading-6">{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <AuditLog />
    </div>
  )
}

function AuditLog() {
  const log = useApi('audit.list', { limit: 100, offset: 0 })
  return (
    <Panel>
      <PanelHeader title="Audit log" subtitle="Most recent 100 recorded actions. Audit entries are never edited." />
      {log.isLoading ? (
        <Spinner />
      ) : !log.data?.length ? (
        <EmptyState icon={ScrollText} title="No audit entries" />
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>
              {log.data.map((a) => (
                <tr key={a.id} className="border-b border-border/60 last:border-0">
                  <td className="whitespace-nowrap px-5 py-2 tabular text-xs text-muted">{fmtDateTime(a.at)}</td>
                  <td className="px-3 py-2 text-xs">{a.username ?? 'system'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-primary">{a.action}</td>
                  <td className="px-5 py-2 text-xs text-muted">{a.note ?? a.entity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
