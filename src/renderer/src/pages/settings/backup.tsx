import { DatabaseBackup, FolderOutput, HardDriveDownload, History, RotateCcw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm'
import { EmptyState, Panel, PanelHeader, Spinner } from '@/components/ui/misc'
import { fmtBytes, fmtDateTime } from '@/lib/format'
import { useApi, useApiMutation } from '@/lib/query'
import { useSession } from '@/lib/session'

const KIND_LABEL = { auto: 'Automatic', manual: 'Manual', pre_restore: 'Pre-restore', pre_update: 'Before update', external: 'Exported' } as const

export function BackupSettings() {
  const { can } = useSession()
  const confirm = useConfirm()
  const backups = useApi('backup.list', undefined, { enabled: can('admin') })
  const integrity = useApiMutation('db.integrity', {
    onSuccess: (r) => (r.ok ? toast.success('Database integrity check passed') : toast.error(`Integrity problems found: ${r.integrity.join('; ')}`))
  })
  const create = useApiMutation('backup.create', { invalidate: ['backup.'], success: (b) => `Backup created: ${b.fileName}` })
  const exportTo = useApiMutation('backup.exportToFolder', {
    invalidate: ['backup.'],
    onSuccess: (r) => r && toast.success(`Backup saved to ${r.path}`)
  })
  const restoreFile = useApiMutation('backup.restoreFromFile', {
    onSuccess: (r) => r.restored && toast.success('Database restored. Please sign in again.')
  })
  const restoreHist = useApiMutation('backup.restoreFromHistory', {
    onSuccess: (r) => r.restored && toast.success('Database restored. Please sign in again.')
  })

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <ActionCard icon={DatabaseBackup} title="Back up now" text="Verified snapshot in the backup folder." onClick={() => create.mutate({ note: 'Manual backup' })} busy={create.isPending} />
        <ActionCard icon={FolderOutput} title="Export to USB / folder" text="Save a verified copy to removable media." onClick={() => exportTo.mutate(undefined)} busy={exportTo.isPending} />
        <ActionCard icon={ShieldCheck} title="Integrity check" text="SQLite integrity and foreign key checks." onClick={() => integrity.mutate(undefined)} busy={integrity.isPending} />
        {can('admin') && (
          <ActionCard icon={HardDriveDownload} title="Restore from file" text="Current data is backed up first." onClick={() => restoreFile.mutate(undefined)} busy={restoreFile.isPending} tone="warning" />
        )}
      </div>

      {can('admin') && (
        <Panel>
          <PanelHeader title="Backup history" subtitle="Backups are consistent snapshots that include WAL contents and are verified after creation." />
          {backups.isLoading ? (
            <Spinner />
          ) : !backups.data?.length ? (
            <EmptyState icon={History} title="No backups yet" message="Automatic backups are taken periodically while data changes." />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-faint">
                <tr className="border-b border-border">
                  <th className="px-5 py-2.5 font-semibold">Created</th>
                  <th className="px-5 py-2.5 font-semibold">Type</th>
                  <th className="px-5 py-2.5 font-semibold">File</th>
                  <th className="px-5 py-2.5 font-semibold">Size</th>
                  <th className="px-5 py-2.5 font-semibold">Integrity</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {backups.data.map((b) => (
                  <tr key={b.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                    <td className="px-5 py-2.5 tabular">{fmtDateTime(b.createdAt)}</td>
                    <td className="px-5 py-2.5">
                      <Badge tone={b.kind === 'pre_restore' || b.kind === 'pre_update' ? 'orange' : b.kind === 'manual' ? 'primary' : 'neutral'}>{KIND_LABEL[b.kind]}</Badge>
                    </td>
                    <td className="max-w-[360px] truncate px-5 py-2.5 font-mono text-xs text-muted" title={b.filePath}>
                      {b.fileName}
                      {!b.exists && <span className="ml-2 text-danger">(missing)</span>}
                    </td>
                    <td className="px-5 py-2.5 tabular text-muted">{fmtBytes(b.sizeBytes)}</td>
                    <td className="px-5 py-2.5">{b.integrity === 'ok' ? <Badge tone="success">OK</Badge> : <Badge tone="danger">{b.integrity}</Badge>}</td>
                    <td className="px-5 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!b.exists || restoreHist.isPending}
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Restore this backup?',
                            message: `All current data will be replaced with the backup from ${fmtDateTime(b.createdAt)}. A verified backup of the current data is created first.`,
                            confirmLabel: 'Restore',
                            tone: 'danger'
                          })
                          if (ok) restoreHist.mutate({ id: b.id })
                        }}
                      >
                        <RotateCcw /> Restore
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}
    </div>
  )
}

interface ActionCardProps {
  icon: typeof DatabaseBackup
  title: string
  text: string
  onClick: () => void
  busy?: boolean
  tone?: 'warning'
}

function ActionCard({ icon: Icon, title, text, onClick, busy, tone }: ActionCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="group flex items-start gap-3.5 rounded-xl border border-border bg-surface-1 p-4 text-left transition-colors hover:border-border-strong hover:bg-surface-2 disabled:opacity-60"
    >
      <div className={`grid size-10 shrink-0 place-items-center rounded-lg ${tone === 'warning' ? 'bg-warning/15 text-warning' : 'bg-primary/15 text-primary'}`}>
        <Icon className={`size-5 ${busy ? 'animate-pulse' : ''}`} />
      </div>
      <div>
        <div className="font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted">{text}</div>
      </div>
    </button>
  )
}
