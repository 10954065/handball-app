import { useEffect, useReducer } from 'react'
import { Flag, Monitor, Pause, Play, TimerReset, Trophy } from 'lucide-react'
import { formatCountdown, formatMatchTime } from '@shared/domain/periods'
import type { LiveMatchDTO, LiveSideDTO } from '@shared/dto'
import { TeamCrest } from '@/components/domain/identity'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

interface ScorebarProps {
  live: LiveMatchDTO
  displayMs: number
  canOperate: boolean
  busy: boolean
  onStartPeriod: () => void
  onToggleClock: () => void
  onAdjustClock: () => void
  onEndPeriod: () => void
  onFinish: () => void
  onScoreboard: () => void
}

function TeamScore({ team, align, shootout }: { team: LiveSideDTO; align: 'left' | 'right'; shootout: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-4', align === 'right' && 'flex-row-reverse')}>
      <TeamCrest logoMediaId={team.logoMediaId} code={team.code} color={team.color} size={56} />
      <div className={cn('min-w-0 flex-1', align === 'right' && 'text-right')}>
        <div className="truncate font-display text-2xl font-bold leading-none tracking-wide">{team.name}</div>
        <div className="mt-1 text-[11px] uppercase tracking-wider text-faint">{team.side === 'home' ? 'Home' : 'Away'}</div>
      </div>
      <div className="text-center">
        <div className="font-display text-[64px] font-bold leading-[0.85] tabular" data-testid={`score-${team.side}`}>
          {team.score}
        </div>
        {shootout && <div className="mt-1 text-xs font-semibold tabular text-gold">({team.shootoutScore})</div>}
      </div>
    </div>
  )
}

/** Informational half-time / break countdown (wall clock; the match clock is stopped). */
function BreakTimer({ startedWall, minutes }: { startedWall: number; minutes: number }) {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  const left = minutes * 60_000 - (Date.now() - startedWall)
  return <span className={cn('tabular', left < 0 && 'text-warning')}>{left >= 0 ? `Break - ${formatCountdown(left)}` : `Break over by ${formatCountdown(-left)}`}</span>
}

export function Scorebar(p: ScorebarProps) {
  const { live } = p
  const { clock, period } = live
  const status = live.match.status
  const shootoutPeriod = period?.kind === 'shootout'
  const inPeriod = clock.phase === 'in_period' && status === 'live'
  const showShootout = !!live.shootout
  const remaining = period && !shootoutPeriod ? period.endMs - p.displayMs : null
  const startLabel = status === 'ready' ? 'Start match' : live.nextPeriod ? `Start ${live.nextPeriod.label.toLowerCase()}` : null

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface-1">
      <div className="absolute inset-y-0 left-0 w-1/3 opacity-[0.12]" style={{ background: `linear-gradient(90deg, ${live.home.color}, transparent)` }} />
      <div className="absolute inset-y-0 right-0 w-1/3 opacity-[0.12]" style={{ background: `linear-gradient(270deg, ${live.away.color}, transparent)` }} />
      <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-6 px-5 py-3">
        <TeamScore team={live.home} align="left" shootout={showShootout} />
        <div className="flex min-w-[280px] flex-col items-center">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            {status === 'finished' ? (
              <Badge tone="neutral">Final{live.match.amended ? ' (amended)' : ''}</Badge>
            ) : status === 'ready' ? (
              'Ready - lineups confirmed'
            ) : clock.phase === 'break' && live.breakStartedWall && live.nextPeriod ? (
              <BreakTimer startedWall={live.breakStartedWall} minutes={live.nextPeriod.breakBeforeMinutes} />
            ) : clock.phase === 'break' ? (
              'End of play'
            ) : (
              period?.label
            )}
          </div>
          {shootoutPeriod ? (
            <div className="my-1 font-display text-4xl font-bold uppercase tracking-wide text-gold">Shoot-out</div>
          ) : (
            <div
              className={cn('font-mono text-[56px] font-bold leading-none tabular', inPeriod && !clock.running ? 'text-suspension' : 'text-text')}
              role="timer"
              aria-label="Match clock"
              data-testid="match-clock"
            >
              {formatMatchTime(p.displayMs)}
            </div>
          )}
          <div className="mt-1 h-4 text-[11px] tabular text-faint">
            {inPeriod && !shootoutPeriod && (clock.running ? `${formatCountdown(remaining ?? 0)} left` : 'Clock stopped')}
            {live.periodScores.length > 0 && !inPeriod && live.periodScores.map((s) => `${s.label} ${s.home}:${s.away}`).join('   ')}
          </div>
        </div>
        <TeamScore team={live.away} align="right" shootout={showShootout} />
      </div>
      <div className="relative flex flex-wrap items-center justify-center gap-2 border-t border-border px-4 py-2">
        {p.canOperate && startLabel && (clock.phase !== 'in_period' || status === 'ready') && (
          <Button onClick={p.onStartPeriod} disabled={p.busy}>
            <Flag /> {startLabel}
          </Button>
        )}
        {p.canOperate && inPeriod && !shootoutPeriod && (
          <>
            <Button variant={clock.running ? 'danger' : 'success'} className="min-w-44" onClick={p.onToggleClock} disabled={p.busy || clock.needsRecovery}>
              {clock.running ? <Pause /> : <Play />} {clock.running ? 'Stop clock' : 'Start clock'}
              <kbd className="ml-1 rounded bg-black/20 px-1 font-mono text-[10px]">Space</kbd>
            </Button>
            <Button variant="secondary" onClick={p.onAdjustClock} disabled={p.busy}>
              <TimerReset /> Correct clock
            </Button>
          </>
        )}
        {p.canOperate && inPeriod && (
          <Button variant="outline" onClick={p.onEndPeriod} disabled={p.busy || clock.running}>
            <Flag /> End {shootoutPeriod ? 'shoot-out' : period?.label.toLowerCase()}
          </Button>
        )}
        {p.canOperate && live.canFinish && (
          <Button variant="primary" onClick={p.onFinish} disabled={p.busy}>
            <Trophy /> Finish match
          </Button>
        )}
        <Button variant="ghost" className="ml-auto" onClick={p.onScoreboard}>
          <Monitor /> Public scoreboard
        </Button>
      </div>
    </div>
  )
}
