import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pause, Play, Square } from 'lucide-react'
import type { AnalysisState, CameraTracksDTO, TrackDTO } from '@shared/vision'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { Panel, PanelHeader } from '@/components/ui/misc'
import { Switch } from '@/components/ui/switch'
import { subscribe } from '@/lib/api'
import { useApi, useApiMutation } from '@/lib/query'
import { useSession } from '@/lib/session'

export interface OverlayOptions {
  boxes: boolean
  ids: boolean
  teams: boolean
}

const STATE_LABEL: Record<AnalysisState, { text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  stopped: { text: 'Stopped', tone: 'neutral' },
  loading: { text: 'Loading model', tone: 'warning' },
  running: { text: 'Analysing', tone: 'success' },
  paused: { text: 'Paused', tone: 'warning' },
  failed: { text: 'Stopped by a fault', tone: 'danger' }
}

const TEAM_COLOUR: Record<'home' | 'away' | 'unknown', string> = { home: 'var(--chart-home)', away: 'var(--chart-away)', unknown: 'var(--text-muted)' }

/** Tracks per camera, kept outside the query cache because they arrive many times a second. */
export function useTracks(): Map<string, CameraTracksDTO> {
  const [tracks, setTracks] = useState(new Map<string, CameraTracksDTO>())
  useEffect(() => subscribe('vision.tracks', (t) => setTracks((current) => new Map(current).set(t.camera, t))), [])
  return tracks
}

function trackLabel(track: TrackDTO, options: OverlayOptions): string {
  const parts = options.ids ? [`#T${track.id}`] : []
  if (options.teams) parts.push(track.team ? `${track.team === 'home' ? 'Home' : 'Away'}?` : 'Team unknown')
  return parts.join(' ')
}

/** Drawn on top of the picture. The viewBox makes one unit one pixel of the original frame. */
export function TrackOverlay({ data, options }: { data: CameraTracksDTO | undefined; options: OverlayOptions }) {
  if (!data) return null
  return (
    <svg viewBox={`0 0 ${data.width} ${data.height}`} preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 size-full" role="img" aria-label={`${data.tracks.length} players tracked`}>
      {data.tracks.map((t) => {
        const colour = TEAM_COLOUR[options.teams ? (t.team ?? 'unknown') : 'unknown']
        const label = trackLabel(t, options)
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

export function AnalysisPanel({ options, onOptions }: { options: OverlayOptions; onOptions: (o: OverlayOptions) => void }) {
  const { can } = useSession()
  const analysis = useAnalysis()
  const matches = useApi('matches.list', { status: ['ready', 'live'], limit: 50 })
  const [matchId, setMatchId] = useState('')
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
    ['Players tracked', state === 'running' ? String(analysis?.tracked ?? 0) : 'Not running'],
    ['Frames skipped', String(analysis?.dropped ?? 0)]
  ]
  const toggle = (key: keyof OverlayOptions) => (checked: boolean) => onOptions({ ...options, [key]: checked })

  return (
    <Panel className="mt-5">
      <PanelHeader title="Analysis" subtitle="Pausing or stopping this never affects the match clock." actions={<Badge tone={label.tone}>{label.text}</Badge>} />
      {analysis?.message && <p className="border-b border-border px-5 py-3 text-sm">{analysis.message}</p>}
      {can('operate_match') && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <Select aria-label="Match" className="w-72" value={matchId} disabled={active} onChange={(e) => setMatchId(e.target.value)}>
            <option value="">No match (no team estimate)</option>
            {matches.data?.map((m) => <option key={m.id} value={m.id}>{m.home.name} v {m.away.name}</option>)}
          </Select>
          {active ? (
            <>
              <Button size="sm" variant="secondary" loading={pause.isPending} disabled={state === 'loading'} onClick={() => pause.mutate({ paused: state === 'running' })}>
                {state === 'paused' ? <><Play /> Resume</> : <><Pause /> Pause</>}
              </Button>
              <Button size="sm" variant="secondary" loading={stop.isPending} onClick={() => stop.mutate(undefined)}><Square /> Stop analysis</Button>
            </>
          ) : (
            <Button size="sm" loading={start.isPending} onClick={() => start.mutate({ matchId: matchId || null, rate: 10 })}><Play /> Start analysis</Button>
          )}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 border-b border-border px-5 py-4 text-sm lg:grid-cols-5">
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
        <Switch checked={options.teams} onCheckedChange={toggle('teams')} label="Team estimate" />
      </div>
    </Panel>
  )
}
