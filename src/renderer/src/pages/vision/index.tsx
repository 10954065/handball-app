import { useEffect, useState } from 'react'
import { Power, PowerOff, ScanEye } from 'lucide-react'
import type { VisionState, VisionStatus } from '@shared/vision'
import { Page } from '@/components/layout/shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorNote, PageHeader, Panel, PanelHeader, Spinner } from '@/components/ui/misc'
import { subscribe } from '@/lib/api'
import { useApi, useApiMutation } from '@/lib/query'
import { useSession } from '@/lib/session'

const STATE_LABEL: Record<VisionState, { text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  stopped: { text: 'Stopped', tone: 'neutral' },
  starting: { text: 'Starting', tone: 'warning' },
  running: { text: 'Running', tone: 'success' },
  restarting: { text: 'Restarting', tone: 'warning' },
  failed: { text: 'Stopped by a fault', tone: 'danger' },
  not_installed: { text: 'Not installed', tone: 'neutral' }
}

const ACTIVE_STATES: VisionState[] = ['running', 'starting', 'restarting']

function useVisionStatus() {
  const initial = useApi('vision.status', undefined, { staleTime: 0 })
  const [pushed, setPushed] = useState<VisionStatus | null>(null)
  useEffect(() => subscribe('vision.status', setPushed), [])
  return { status: pushed ?? initial.data, error: initial.error }
}

export function VisionPage() {
  const { status, error } = useVisionStatus()
  const { can } = useSession()
  const start = useApiMutation('vision.start')
  const stop = useApiMutation('vision.stop')
  if (error) return <Page><ErrorNote error={error} /></Page>
  if (!status) return <Spinner />
  const label = STATE_LABEL[status.state]
  const active = ACTIVE_STATES.includes(status.state)

  return (
    <Page>
      <PageHeader
        icon={ScanEye}
        title="AI Vision"
        subtitle="Camera analysis that suggests events. An official confirms everything, and the match console never depends on it."
        actions={
          can('operate_match') &&
          (active ? (
            <Button variant="secondary" loading={stop.isPending} onClick={() => stop.mutate(undefined)}>
              <PowerOff /> Stop AI service
            </Button>
          ) : (
            <Button disabled={status.state === 'not_installed'} loading={start.isPending} onClick={() => start.mutate(undefined)}>
              <Power /> Start AI service
            </Button>
          ))
        }
      />
      <Panel>
        <PanelHeader title="Service" actions={<Badge tone={label.tone}>{label.text}</Badge>} />
        {status.message && <p className="border-b border-border px-5 py-3 text-sm">{status.message}</p>}
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 px-5 py-4 text-sm lg:grid-cols-4">
          <Figure label="Service version" value={status.version ?? 'Not running'} />
          <Figure label="Computer memory" value={status.health ? `${status.health.memoryUsedMb.toLocaleString()} of ${status.health.memoryTotalMb.toLocaleString()} MB` : 'Not running'} />
          <Figure label="Processor" value={status.health ? `${Math.round(status.health.cpuPercent)}%` : 'Not running'} />
          <Figure label="Service memory" value={status.health ? `${status.health.serviceMemoryMb.toLocaleString()} MB` : 'Not running'} />
        </dl>
      </Panel>
    </Page>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 tabular">{value}</dd>
    </div>
  )
}
