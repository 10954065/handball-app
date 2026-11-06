import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Camera, CameraOff, Goal, Pencil, Plus, Trash2, Video } from 'lucide-react'
import { CAMERA_KIND_LABELS, CAMERA_ROLE_LABELS, type BallPositionDTO, type CameraDTO, type CameraFeedDTO, type CameraTracksDTO, type FeedState } from '@shared/vision'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm'
import { EmptyState, Panel, PanelHeader, Spinner } from '@/components/ui/misc'
import { subscribe } from '@/lib/api'
import { useApi, useApiMutation } from '@/lib/query'
import { useSession } from '@/lib/session'
import { AnalysisPanel, TrackOverlay, useBall, useTracks, type OverlayOptions } from './analysis'
import { CameraDialog } from './camera-dialog'
import { GoalAreasDialog } from './goal-areas'

/** Ten pictures a second is what the service sends. Asking faster gains nothing. */
const PICTURE_INTERVAL_MS = 100
const RETRY_INTERVAL_MS = 400

const FEED_LABEL: Record<FeedState, { text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  connecting: { text: 'Connecting', tone: 'warning' },
  live: { text: 'Live', tone: 'success' },
  reconnecting: { text: 'Reconnecting', tone: 'warning' },
  ended: { text: 'Video ended', tone: 'neutral' },
  failed: { text: 'Failed', tone: 'danger' },
  closed: { text: 'Closed', tone: 'neutral' }
}

function useFeeds(): CameraFeedDTO[] {
  const qc = useQueryClient()
  const feeds = useApi('vision.feeds', undefined, { staleTime: 0 })
  useEffect(() => subscribe('vision.feeds', (states) => qc.setQueryData(['vision.feeds', null], states)), [qc])
  return feeds.data ?? []
}

/** Asks for the next picture only once the last has been drawn, so requests can never pile up. */
function FeedPicture({ feed, name }: { feed: CameraFeedDTO; name: string }) {
  const [tick, setTick] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const next = (delay: number) => {
    timer.current = setTimeout(() => setTick((t) => t + 1), delay)
  }
  return (
    <img
      src={`hmms-vision://frame/${feed.id}?n=${tick}`}
      alt={`Live picture from ${name}`}
      className="aspect-video w-full rounded-lg bg-black object-contain"
      onLoad={() => next(PICTURE_INTERVAL_MS)}
      onError={() => next(RETRY_INTERVAL_MS)}
    />
  )
}

function FeedTile({ feed, camera, tracks, ball, overlay, onGoals }: { feed: CameraFeedDTO; camera: CameraDTO | undefined; tracks: CameraTracksDTO | undefined; ball: BallPositionDTO | undefined; overlay: OverlayOptions; onGoals: () => void }) {
  const { can } = useSession()
  const swap = useApiMutation('cameras.swapEnds', { invalidate: ['cameras.'], success: 'Ends changed' })
  const name = camera?.name ?? 'Camera'
  const label = FEED_LABEL[feed.state]
  return (
    <figure className="min-w-0" aria-label={`Camera ${name}`}>
      <div className="relative">
        <FeedPicture feed={feed} name={name} />
        <TrackOverlay data={tracks} ball={ball} options={overlay} />
      </div>
      <figcaption className="mt-2 flex items-center justify-between gap-2 text-sm">
        <span className="truncate font-medium">{name}</span>
        <span className="flex items-center gap-2 text-xs text-muted">
          {feed.width && feed.height && <span className="tabular">{feed.width} x {feed.height}</span>}
          <Badge tone={label.tone}>{label.text}</Badge>
        </span>
      </figcaption>
      {feed.message && <p className="mt-1 text-xs text-muted">{feed.message}</p>}
      {can('operate_match') && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onGoals}><Goal /> Mark goal areas</Button>
          {camera?.goalAreas && <Button size="sm" variant="secondary" loading={swap.isPending} onClick={() => swap.mutate({ id: feed.id })}><ArrowLeftRight /> Change ends</Button>}
        </div>
      )}
    </figure>
  )
}

function CameraRow({ camera, feed, onEdit }: { camera: CameraDTO; feed: CameraFeedDTO | undefined; onEdit: () => void }) {
  const { can } = useSession()
  const confirm = useConfirm()
  const open = useApiMutation('vision.openCamera')
  const close = useApiMutation('vision.closeCamera')
  const remove = useApiMutation('cameras.delete', { invalidate: ['cameras.'], success: 'Camera removed' })
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <Video className="size-4 shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{camera.name}</p>
        <p className="truncate text-xs text-muted">{CAMERA_KIND_LABELS[camera.kind]}, {CAMERA_ROLE_LABELS[camera.role]}</p>
      </div>
      {can('operate_match') &&
        (feed ? (
          <Button size="sm" variant="secondary" loading={close.isPending} onClick={() => close.mutate({ id: camera.id })}><CameraOff /> Close</Button>
        ) : (
          <Button size="sm" variant="secondary" loading={open.isPending} onClick={() => open.mutate({ id: camera.id })}><Camera /> Open</Button>
        ))}
      {can('manage_data') && (
        <>
          <Button size="sm" variant="ghost" aria-label={`Edit ${camera.name}`} onClick={onEdit}><Pencil /></Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove ${camera.name}`}
            onClick={async () => {
              if (await confirm({ title: `Remove ${camera.name}?`, confirmLabel: 'Remove', tone: 'danger' })) remove.mutate({ id: camera.id })
            }}
          >
            <Trash2 />
          </Button>
        </>
      )}
    </li>
  )
}

export function CamerasPanel() {
  const { can } = useSession()
  const cameras = useApi('cameras.list')
  const feeds = useFeeds()
  const tracks = useTracks()
  const balls = useBall()
  const [overlay, setOverlay] = useState<OverlayOptions>({ boxes: true, ids: true, teams: true, ball: true })
  const [marking, setMarking] = useState<CameraDTO | null>(null)
  const [editing, setEditing] = useState<CameraDTO | 'new' | null>(null)
  return (
    <>
      <Panel className="mt-5">
        <PanelHeader
          title="Cameras"
          subtitle="Up to three can run at once."
          actions={can('manage_data') && <Button size="sm" onClick={() => setEditing('new')}><Plus /> Add camera</Button>}
        />
        {cameras.isLoading ? (
          <Spinner />
        ) : !cameras.data?.length ? (
          <EmptyState icon={Camera} title="No cameras yet" message="Add a USB webcam, a network camera, a phone, or a video file to analyse." />
        ) : (
          <ul className="divide-y divide-border">
            {cameras.data.map((c) => <CameraRow key={c.id} camera={c} feed={feeds.find((f) => f.id === c.id)} onEdit={() => setEditing(c)} />)}
          </ul>
        )}
      </Panel>
      {feeds.length > 0 && (
        <Panel className="mt-5 p-5">
          <div className="grid gap-5 lg:grid-cols-2" aria-label="Live cameras">
            {feeds.map((f) => <FeedTile key={f.id} feed={f} camera={cameras.data?.find((c) => c.id === f.id)} tracks={tracks.get(f.id)} ball={balls.get(f.id)} overlay={overlay} onGoals={() => setMarking(cameras.data?.find((c) => c.id === f.id) ?? null)} />)}
          </div>
        </Panel>
      )}
      {feeds.length > 0 && <AnalysisPanel options={overlay} onOptions={setOverlay} />}
      {marking && <GoalAreasDialog camera={marking} onClose={() => setMarking(null)} />}
      {editing && <CameraDialog camera={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}
