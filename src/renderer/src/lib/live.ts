import { useEffect, useMemo, useReducer } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LiveClockDTO, LiveMatchDTO, LiveTimeoutDTO } from '@shared/dto'
import type { PeriodDef } from '@shared/domain/periods'
import { subscribe } from './api'
import { useApi } from './query'

/** Re-read the authoritative state this often while the clock runs, to absorb any drift. */
const RESYNC_MS = 5_000
/** Repaint interval of the displayed clock. Display only: the time itself comes from main. */
const PAINT_MS = 100

export const liveKey = (matchId: string) => ['live.get', { matchId }] as const

/** Live match state, refreshed whenever the main process reports a change. */
export function useLive(matchId: string) {
  const qc = useQueryClient()
  const q = useApi('live.get', { matchId }, { staleTime: 0, refetchInterval: (query) => (query.state.data?.clock.running ? RESYNC_MS : false) })
  useEffect(
    () =>
      subscribe('live.changed', (p) => {
        if (p.matchId === matchId) void qc.invalidateQueries({ queryKey: liveKey(matchId) })
      }),
    [qc, matchId]
  )
  return q
}

/** Store a fresh live state returned by a mutation, so the screen updates without a round trip. */
export function useSetLive(matchId: string) {
  const qc = useQueryClient()
  return (data: LiveMatchDTO) => {
    qc.setQueryData(liveKey(matchId), data)
    void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && /^(matches|dashboard|statistics|reports|seasons|knockout|competitions)\./.test(q.queryKey[0] as string) })
  }
}

/**
 * The time to display. The main process sends elapsed time at the moment of the snapshot; while
 * running, the display extrapolates with the renderer's own monotonic clock and never passes the
 * end of the period (where the main process stops the clock).
 */
export function useDisplayClock(clock: LiveClockDTO | undefined, period: PeriodDef | null | undefined): number {
  const receivedAt = useMemo(() => performance.now(), [clock])
  const [, repaint] = useReducer((n: number) => n + 1, 0)
  const running = !!clock?.running
  useEffect(() => {
    if (!running) return
    const id = setInterval(repaint, PAINT_MS)
    return () => clearInterval(id)
  }, [running])
  if (!clock) return 0
  if (!running) return clock.elapsedMs
  const ms = clock.elapsedMs + (performance.now() - receivedAt)
  return period && period.kind !== 'shootout' ? Math.min(ms, period.endMs) : ms
}

/** Milliseconds left in a team time-out, counted from the main-process snapshot. */
export function useTimeoutRemaining(timeout: LiveTimeoutDTO | null | undefined): number {
  const receivedAt = useMemo(() => performance.now(), [timeout])
  const [, repaint] = useReducer((n: number) => n + 1, 0)
  const active = !!timeout
  useEffect(() => {
    if (!active) return
    const id = setInterval(repaint, PAINT_MS)
    return () => clearInterval(id)
  }, [active])
  if (!timeout) return 0
  return Math.max(0, timeout.durationMs - timeout.elapsedMs - (performance.now() - receivedAt))
}

let audio: AudioContext | null = null

/** Short horn generated in-app (no sound files, works offline). */
export function playHorn(volume: number): void {
  try {
    audio ??= new AudioContext()
    const t = audio.currentTime
    const gain = audio.createGain()
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(Math.max(0.05, Math.min(1, volume)) * 0.6, t + 0.04)
    gain.gain.setValueAtTime(Math.max(0.05, Math.min(1, volume)) * 0.6, t + 1.1)
    gain.gain.linearRampToValueAtTime(0, t + 1.3)
    gain.connect(audio.destination)
    for (const f of [220, 277, 330]) {
      const osc = audio.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = f
      osc.connect(gain)
      osc.start(t)
      osc.stop(t + 1.35)
    }
  } catch {
    // Audio is a courtesy; the visual signal is authoritative.
  }
}

/** Two short tones: a timer has expired or a time-out is about to end. */
export function playBeep(volume: number): void {
  try {
    audio ??= new AudioContext()
    const level = Math.max(0.05, Math.min(1, volume)) * 0.5
    for (const at of [0, 0.28]) {
      const t = audio.currentTime + at
      const gain = audio.createGain()
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(level, t + 0.02)
      gain.gain.linearRampToValueAtTime(0, t + 0.2)
      gain.connect(audio.destination)
      const osc = audio.createOscillator()
      osc.frequency.value = 880
      osc.connect(gain)
      osc.start(t)
      osc.stop(t + 0.22)
    }
  } catch {
    // Audio is a courtesy; the visual signal is authoritative.
  }
}

/** Parse "MM:SS" (minutes may exceed 59) to milliseconds. */
export function parseMatchTime(text: string): number | null {
  const m = /^\s*(\d{1,3}):([0-5]\d)\s*$/.exec(text)
  return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : null
}
