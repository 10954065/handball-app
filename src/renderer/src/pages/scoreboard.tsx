import { useParams } from 'react-router-dom'
import { formatMatchTime } from '@shared/domain/periods'
import type { LiveMatchDTO, LiveSideDTO } from '@shared/dto'
import { TeamCrest } from '@/components/domain/identity'
import { useDisplayClock, useLive } from '@/lib/live'
import { useApi } from '@/lib/query'
import { useSession } from '@/lib/session'
import { eventTitle } from './live/labels'

/** Public scoreboard for a second monitor or projector. Read-only; driven by the operator screen. */
export function ScoreboardPage() {
  const { id = '' } = useParams()
  const { user, isLoading } = useSession()
  if (isLoading) return <Blank />
  if (!user) return <Blank message="Sign in on the operator screen to show the scoreboard." />
  return <Board matchId={id} />
}

function Blank({ message }: { message?: string }) {
  return (
    <div className="grid h-full place-items-center bg-black text-[3vh] text-white/50">
      <div className="text-center">
        <div className="font-display text-[8vh] font-bold tracking-[0.2em] text-white/80">HMMS</div>
        {message && <p className="mt-4">{message}</p>}
      </div>
    </div>
  )
}

function Board({ matchId }: { matchId: string }) {
  const q = useLive(matchId)
  const settings = useApi('settings.get').data
  const status = useSession().status
  const live = q.data
  const ms = useDisplayClock(live?.clock, live?.period)
  if (!live) return <Blank message={q.error ? 'The match could not be loaded.' : undefined} />
  const logos = settings?.scoreboard.showLogos ?? true
  const shootout = live.period?.kind === 'shootout'
  const lastGoal = live.events.find((e) => e.type === 'shot' && e.outcome === 'goal' && e.status === 'active')
  return (
    <div className="relative flex h-full flex-col bg-black px-[4vw] py-[4vh] text-white" data-testid="scoreboard">
      {status?.mode === 'demo' && <div className="absolute right-[2vw] top-[1.5vh] text-[1.6vh] font-bold uppercase tracking-[0.3em] text-gold">Demonstration</div>}
      <div className="grid flex-1 grid-cols-[1fr_auto_1fr] items-center gap-[3vw]">
        <Side team={live.home} logos={logos} shootout={!!live.shootout} />
        <div className="flex flex-col items-center">
          <div className="text-[3.4vh] font-semibold uppercase tracking-[0.25em] text-white/60">{phaseLabel(live)}</div>
          {shootout ? (
            <div className="font-display text-[14vh] font-bold uppercase leading-none text-gold">Shoot-out</div>
          ) : (
            <div className={`font-mono text-[20vh] font-bold leading-none tabular ${clockTone(live)}`}>{formatMatchTime(ms)}</div>
          )}
          <div className="mt-[1vh] text-[2.6vh] tabular text-white/50">{live.periodScores.map((s) => `${s.label} ${s.home}:${s.away}`).join('    ')}</div>
        </div>
        <Side team={live.away} logos={logos} shootout={!!live.shootout} />
      </div>
      <div className="h-[6vh] text-center text-[3vh] text-white/70">
        {lastGoal?.player && (
          <span>
            {eventTitle(lastGoal, live)}: <b className="text-white">#{lastGoal.player.jerseyNumber} {lastGoal.player.name}</b> ({lastGoal.side && live[lastGoal.side].code}) {formatMatchTime(lastGoal.matchMs)}
          </span>
        )}
      </div>
    </div>
  )
}

/** White while running, orange when stopped during play, dimmed outside play. */
const clockTone = (live: LiveMatchDTO) =>
  live.clock.running ? 'text-white' : live.clock.phase === 'in_period' ? 'text-suspension' : 'text-white/45'

function phaseLabel(live: LiveMatchDTO): string {
  if (live.match.status === 'finished') return 'Final'
  if (live.match.status === 'ready') return 'Match about to start'
  if (live.clock.phase === 'break') return live.nextPeriod ? `Break - next: ${live.nextPeriod.label}` : 'End of play'
  return live.period?.label ?? ''
}

function Side({ team, logos, shootout }: { team: LiveSideDTO; logos: boolean; shootout: boolean }) {
  return (
    <div className="flex flex-col items-center gap-[2vh] text-center">
      {logos && <TeamCrest logoMediaId={team.logoMediaId} code={team.code} color={team.color} size={Math.round(window.innerHeight * 0.14)} />}
      <div className="line-clamp-2 font-display text-[5.5vh] font-bold uppercase leading-tight tracking-wide">{team.name}</div>
      <div className="h-[1vh] w-[40%] rounded-full" style={{ background: team.color }} />
      <div className="font-display text-[26vh] font-bold leading-[0.85] tabular" data-testid={`board-score-${team.side}`}>{team.score}</div>
      {shootout && <div className="text-[4vh] font-semibold tabular text-gold">Shoot-out {team.shootoutScore}</div>}
    </div>
  )
}
