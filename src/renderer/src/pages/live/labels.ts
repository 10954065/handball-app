import type { LiveEventDTO } from '@shared/dto'

export { eventDetail, eventTitle } from '@shared/domain/event-labels'

export type Tone = 'goal' | 'miss' | 'play' | 'sub' | 'system' | 'note' | 'warning' | 'suspension' | 'red' | 'timeout'

export function eventTone(e: LiveEventDTO): Tone {
  if (e.type === 'shot') return e.outcome === 'goal' ? 'goal' : 'miss'
  if (e.type === 'substitution') return 'sub'
  if (e.type === 'note') return 'note'
  if (e.type === 'warning') return 'warning'
  if (e.type === 'suspension') return 'suspension'
  if (e.type === 'disqualification') return 'red'
  if (e.type === 'timeout') return 'timeout'
  if (e.type === 'period_start' || e.type === 'period_end' || e.type === 'clock_adjust') return 'system'
  return 'play'
}
