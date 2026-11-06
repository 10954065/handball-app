import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pause, Play, Shirt, Square } from 'lucide-react'
import { personLabel, type AnalysisState, type CameraTracksDTO, type TeamSheetDTO, type TrackDTO } from '@shared/vision'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/input'
import { Panel, PanelHeader } from '@/components/ui/misc'
import { Switch } from '@/components/ui/switch'
import { subscribe } from '@/lib/api'
import { useApi, useApiMutation } from '@/lib/query'
import { useSession } from '@/lib/session'
import { ShirtDialog, ShirtSwatches } from './shirts'

export interface OverlayOptions {
  boxes: boolean
  ids: boolean
  roles: boolean
}

const STATE_LABEL: Record<AnalysisState, { text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  stopped: { text: 'Stopped', tone: 'neutral' },
  loading: { text: 'Loading model', tone: 'warning' },
  running: { text: 'Analysing', tone: 'success' },
  paused: { text: 'Paused', tone: 'warning' },
  failed: { text: 'Stopped by a fault', tone: 'danger' }
}

const ROLE_COLOUR: Record<'a' | 'b' | 'official' | 'unknown', string> = { a: 'var(--chart-home)', b: 'var(--chart-away)', official: 'var(--gold)', unknown: 'var(--text-muted)' }

/** Tracks per camera, kept outside the query cache because they arrive many times a second. */
export function useTracks(): Map<string, CameraTracksDTO> {
  const [tracks, setTracks] = useState(new Map<string, CameraTracksDTO>())
  useEffect(() => subscribe('vision.tracks', (t) => setTracks((current) => new Map(current).set(t.camera, t))), [])
  return tracks
}

function trackLabel(track: TrackDTO, options: OverlayOptions, sheet: TeamSheetDTO | null | undefined): string {
  const parts = options.ids ? [`#T${track.id}`] : []
  if (options.roles) parts.push(personLabel(track, sheet))
  return parts.join(' ')
}

/** Drawn on top of the picture. The viewBox makes one unit one pixel of the original frame. */
export function TrackOverlay({ data, options }: { data: CameraTracksDTO | undefined; options: OverlayOptions }) {
  const sheet = useApi('vision.teamSheet', undefined, { staleTime: 0 }).data
  if (!data) return null
  return (
    <svg viewBox={`0 0 ${data.width} ${data.height}`} preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 size-full" role="img" aria-label={`${data.tracks.length} players tracked`}>
      {data.tracks.map((t) => {
        const colour = ROLE_COLOUR[options.roles ? (t.role ?? 'unknown') : 'unknown']
        const label = trackLabel(t, options, sheet)
        return (
          <g key={t.id}>
            {options.boxes && <rect x={t.x} y={t.y} width={t.w} height={t.h} fill="none" stroke={colour} strokeWidth={data.width / 480} />}
            {label && (
              <text x={t.x} y={t.y - data.height / 160} fill={colour} fontSize={data.height / 42} fontWeight={600} stroke="#000" strokeWidth={data.height / 720} paintOrder="stroke">
                {label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function useAnalysis() {
  const qc = useQueryClient()
  const analysis = useApi('vision.analysis', undefined, { staleTime: 0 })
  useEffect(() => subscribe('vision.analysis', (a) => qc.setQueryData(['vision.analysis', null], a)), [qc])
  return analysis.data
}

/** Which match's players the camera may name. Nothing else about the match reaches the analysis. */
function MatchPicker({ sheet }: { sheet: TeamSheetDTO | null | undefined }) {
  const matches = useApi('matches.list', { limit: 200 })
  const choose = useApiMutation('vision.setTeamSheet', { invalidate: ['vision.teamSheet'] })
  const players = sheet ? sheet.a.players.length + sheet.b.players.length : 0
  return (
    <div className="border-b border-border px-5 py-3">
      <Field label="Match" htmlFor="vision-match">
        <Select id="vision-match" value={sheet?.matchId ?? ''} disabled={choose.isPending} onChange={(e) => choose.mutate({ matchId: e.target.value || null })}>
          <option value="">No match: follow people without naming them</option>
          {matches.data?.map((m) => <option key={m.id} value={m.id}>{m.home.name} v {m.away.name} ({m.matchNumber})</option>)}
        </Select>
      </Field>
      {sheet && <p className="mt-2 text-xs text-muted">{players} players on the match sheet. Set shirt colours too, so numbers are checked against the right team. A player is named only after their number has been read several times, and anyone else stays unnamed.</p>}
    </div>
  )
}

export function AnalysisPanel({ options, onOptions, cameraId }: { options: OverlayOptions; onOptions: (o: OverlayOptions) => void; cameraId: string | null }) {
  const { can } = useSession()
  const analysis = useAnalysis()
  const shirts = useApi('vision.shirts', undefined, { staleTime: 0 })
  const sheet = useApi('vision.teamSheet', undefined, { staleTime: 0 }).data
  const [picking, setPicking] = useState(false)
  const start = useApiMutation('vision.startAnalysis')
  const stop = useApiMutation('vision.stopAnalysis')
  const pause = useApiMutation('vision.pauseAnalysis')
  const state = analysis?.state ?? 'stopped'
  const label = STATE_LABEL[state]
  const active = state === 'running' || state === 'paused' || state === 'loading'
  const figures: [string, string][] = [
    ['Running on', analysis?.backend ?? 'Not running'],
    ['Analysis speed', state === 'running' ? `${analysis?.fps ?? 0} frames a second` : 'Not running'],
    ['Time per frame', state === 'running' ? `${analysis?.inferenceMs ?? 0} ms` : 'Not running'],
    ['People followed', state === 'running' ? String(analysis?.tracked ?? 0) : 'Not running'],
    ['Players named', state === 'running' ? String(analysis?.named ?? 0) : 'Not running'],
    ['Frames skipped', String(analysis?.dropped ?? 0)]
  ]
  const toggle = (key: keyof OverlayOptions) => (checked: boolean) => onOptions({ ...options, [key]: checked })

  return (
    <Panel className="mt-5">
      <PanelHeader title="Analysis" subtitle="Follows the players and the two officials. It never affects the match clock." actions={<Badge tone={label.tone}>{label.text}</Badge>} />
      {analysis?.message && <p className="border-b border-border px-5 py-3 text-sm">{analysis.message}</p>}
      {can('operate_match') && <MatchPicker sheet={sheet} />}
      {can('operate_match') && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <Button size="sm" variant="secondary" disabled={cameraId === null} onClick={() => setPicking(true)}><Shirt /> Set shirt colours</Button>
          <ShirtSwatches shirts={shirts.data ?? {}} sheet={sheet} />
          {active ? (
            <>
              <Button size="sm" variant="secondary" loading={pause.isPending} disabled={state === 'loading'} onClick={() => pause.mutate({ paused: state === 'running' })}>
                {state === 'paused' ? <><Play /> Resume</> : <><Pause /> Pause</>}
              </Button>
              <Button size="sm" variant="secondary" loading={stop.isPending} onClick={() => stop.mutate(undefined)}><Square /> Stop analysis</Button>
            </>
          ) : (
            <Button size="sm" loading={start.isPending} onClick={() => start.mutate({ rate: 10 })}><Play /> Start analysis</Button>
          )}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 border-b border-border px-5 py-4 text-sm lg:grid-cols-6">
        {figures.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{k}</dt>
            <dd className="mt-0.5 tabular">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-6 px-5 py-3">
        <Switch checked={options.boxes} onCheckedChange={toggle('boxes')} label="Player boxes" />
        <Switch checked={options.ids} onCheckedChange={toggle('ids')} label="Tracking numbers" />
        <Switch checked={options.roles} onCheckedChange={toggle('roles')} label="Names and team labels" />
      </div>
      {picking && cameraId && <ShirtDialog cameraId={cameraId} shirts={shirts.data ?? {}} sheet={sheet} onClose={() => setPicking(false)} />}
    </Panel>
  )
}
