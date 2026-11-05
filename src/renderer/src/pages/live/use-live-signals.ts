import { useEffect, useRef } from 'react'
import { TIMEOUT_WARNING_SECONDS } from '@shared/domain/timeouts'
import type { AppSettings, LiveMatchDTO } from '@shared/dto'
import { playBeep, playHorn } from '@/lib/live'

const activeTimers = (live: LiveMatchDTO) => [...live.home.reductions, ...live.away.reductions]

/**
 * Audible signals on the operator screen, each with its own setting. Sound is a courtesy: the
 * same information is always visible. A voided timer or time-out stays silent.
 */
export function useLiveSignals(live: LiveMatchDTO, sound: AppSettings['sound'] | undefined) {
  const on = !!sound?.enabled
  const volume = sound?.volume ?? 0.8
  const wasRunning = useRef(live.clock.running)
  const timers = useRef(new Set(activeTimers(live).map((t) => t.eventId)))
  const timeoutId = useRef(live.timeout?.id ?? null)
  const timeoutEvent = useRef<string | null>(null)

  useEffect(() => {
    const atEnd = !!live.period && live.period.kind !== 'shootout' && live.clock.elapsedMs >= live.period.endMs
    if (wasRunning.current && !live.clock.running && atEnd && on && sound?.periodEnd) playHorn(volume)
    wasRunning.current = live.clock.running

    const now = new Set(activeTimers(live).map((t) => t.eventId))
    const expired = [...timers.current].some((id) => !now.has(id) && live.events.find((e) => e.id === id)?.status === 'active')
    if (expired && on && sound?.suspensionExpiry) playBeep(volume)
    timers.current = now

    const ended = timeoutId.current && !live.timeout
    const voided = live.events.find((e) => e.id === timeoutEvent.current)?.status === 'voided'
    if (ended && !voided && on && sound?.timeoutEnd) playHorn(volume)
    timeoutId.current = live.timeout?.id ?? null
    timeoutEvent.current = live.timeout?.eventId ?? null
  }, [live, on, volume, sound])

  // Warning signal shortly before the end of a team time-out.
  const remaining = live.timeout ? live.timeout.durationMs - live.timeout.elapsedMs : 0
  const warnIn = remaining - TIMEOUT_WARNING_SECONDS * 1000
  useEffect(() => {
    if (!live.timeout?.id || warnIn <= 0 || !on || !sound?.timeoutEnd) return
    const id = setTimeout(() => playBeep(volume), warnIn)
    return () => clearTimeout(id)
    // Rescheduled when a new time-out starts, not on every resynchronisation.
  }, [live.timeout?.id, on, sound?.timeoutEnd])
}
