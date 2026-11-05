import { DatabaseBackup, HardDrive, LayoutDashboard, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Page } from '@/components/layout/shell'
import { Button } from '@/components/ui/button'
import { PageHeader, Panel, PanelHeader, Stat } from '@/components/ui/misc'
import { fmtDateTime } from '@/lib/format'
import { useApi, useApiMutation } from '@/lib/query'
import { useSession } from '@/lib/session'

export function DashboardPage() {
  const { user, can } = useSession()
  const settings = useApi('settings.get')
  const info = useApi('app.info')
  const backups = useApi('backup.list', undefined, { enabled: can('admin') })
  const integrity = useApi('db.integrity')
  const backup = useApiMutation('backup.create', { invalidate: ['backup.'], success: (b) => `Backup created: ${b.fileName}` })
  const last = backups.data?.[0]

  return (
    <Page>
      <PageHeader
        icon={LayoutDashboard}
        title={`Welcome, ${user?.displayName.split(' ')[0] ?? ''}`}
        subtitle={settings.data?.organisationName || 'Handball Match Management System'}
        actions={
          can('manage_data') && (
            <Button variant="secondary" loading={backup.isPending} onClick={() => backup.mutate({ note: 'Manual backup from dashboard' })}>
              <DatabaseBackup /> Back up now
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat
          label="Database integrity"
          value={integrity.data ? (integrity.data.ok ? 'Healthy' : 'Problem') : '...'}
          accent={integrity.data?.ok ? 'text-goal' : 'text-danger'}
          hint={integrity.data && `Checked ${fmtDateTime(integrity.data.checkedAt)}`}
        />
        <Stat label="Last backup" value={last ? fmtDateTime(last.createdAt).split(',')[0] : 'None'} hint={last ? last.fileName : 'Automatic backups run while data changes'} />
        <Stat label="Data mode" value={info.data?.mode === 'demo' ? 'Demo' : 'Production'} accent={info.data?.mode === 'demo' ? 'text-gold' : undefined} hint="Offline - stored on this computer" />
      </div>
      <Panel className="mt-5">
        <PanelHeader title="Local data storage" />
        <div className="grid gap-4 p-5 text-sm md:grid-cols-2">
          <div className="flex gap-3">
            <HardDrive className="mt-0.5 size-5 text-primary" />
            <div>
              <div className="font-medium">Database</div>
              <div className="mt-1 break-all font-mono text-xs text-muted">{info.data?.dbFile}</div>
            </div>
          </div>
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 size-5 text-goal" />
            <div>
              <div className="font-medium">Backups</div>
              <div className="mt-1 break-all font-mono text-xs text-muted">{info.data?.backupDir}</div>
              <Link to="/settings" className="mt-2 inline-block text-xs text-primary hover:underline">
                Manage backup and restore
              </Link>
            </div>
          </div>
        </div>
      </Panel>
    </Page>
  )
}
