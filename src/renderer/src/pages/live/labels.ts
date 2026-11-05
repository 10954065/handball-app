import { SHOT_SITUATION_LABELS, SHOT_ZONE_LABELS } from '@shared/domain/constants'
import type { LiveEventDTO, LiveMatchDTO } from '@shared/dto'

export type Tone = 'goal' | 'miss' | 'play' | 'sub' | 'system' | 'note' | 'warning' | 'suspension' | 'red' | 'timeout'

const PLAY_LABELS: Record<string, string> = {
  technical_fault: 'Technical fault',
  turnover: 'Turnover',
  steal: 'Steal',
  block: 'Block',
  warning: 'Warning',
  suspension: '2-minute suspension',
  disqualification: 'Disqualification',
  timeout: 'Team time-out'
}

const OUTCOME: Record<string, string> = { goal: 'Goal', saved: 'Saved', missed: 'Missed', blocked: 'Blocked', post: 'Post / crossbar' }

export function eventTitle(e: LiveEventDTO, live: Pick<LiveMatchDTO, 'plan'>): string {
  const period = live.plan.find((p) => p.seq === e.periodSeq)
  switch (e.type) {
    case 'shot': {
      const base = OUTCOME[e.outcome ?? ''] ?? 'Shot'
      if (e.situation === 'seven_metre') return `7 m ${base.toLowerCase()}`
      if (e.situation === 'shootout') return `Shoot-out ${base.toLowerCase()}`
      return base
    }
    case 'substitution':
      return 'Substitution'
    case 'period_start':
      return `Start - ${period?.label ?? 'period'}`
    case 'period_end':
      return `End - ${period?.label ?? 'period'}`
    case 'clock_adjust':
      return 'Clock corrected'
    case 'note':
      return 'Note'
    case 'disqualification':
      return e.blueCard ? 'Red and blue card' : 'Red card'
    default:
      return PLAY_LABELS[e.type] ?? e.type
  }
}

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

export function eventDetail(e: LiveEventDTO): string {
  const parts: string[] = []
  if (e.type === 'shot') {
    const s = e.situation
    if (s && s !== 'positional' && s !== 'seven_metre' && s !== 'shootout') parts.push(SHOT_SITUATION_LABELS[s])
    if (e.zone) parts.push(SHOT_ZONE_LABELS[e.zone])
    if (e.assist) parts.push(`assist #${e.assist.jerseyNumber} ${e.assist.name}`)
    if (e.goalkeeper) parts.push(`GK #${e.goalkeeper.jerseyNumber}`)
  }
  if (e.type === 'substitution' && e.inPlayer) parts.push(`on #${e.inPlayer.jerseyNumber} ${e.inPlayer.name}`)
  if (e.blueCard) parts.push('written report required')
  if (e.text && e.type !== 'shot' && e.type !== 'substitution') parts.push(e.text)
  return parts.join(' - ')
}
