import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarPlus, Crown, GitBranch, Trash2 } from 'lucide-react'
import { MATCH_STAGE_LABELS } from '@shared/domain/constants'
import type { BracketDTO, BracketTieDTO, SeasonDTO } from '@shared/dto'
import { TeamCrest } from '@/components/domain/identity'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm'
import { EmptyState, Panel, PanelHeader, Spinner } from '@/components/ui/misc'
import { cn } from '@/lib/cn'
import { fmtDateTime } from '@/lib/format'
import { useApi, useApiMutation } from '@/lib/query'
import { CreateBracketDialog, ScheduleTieDialog } from './knockout-dialog'

const COLUMNS = ['round_of_16', 'quarter_final', 'semi_final', 'final'] as const

const scoreOf = (t: BracketTieDTO, side: 'home' | 'away') => (side === 'home' ? t.match?.homeScore : t.match?.awayScore)

function TieTeam({ tie, side }: { tie: BracketTieDTO; side: 'home' | 'away' }) {
  const team = tie[side]
  const source = side === 'home' ? tie.homeSource : tie.awaySource
  const won = !!team && team.teamId === tie.winnerTeamId
  const shootout = side === 'home' ? tie.match?.homeShootout : tie.match?.awayShootout
  return (
    <div className={cn('flex items-center gap-2 px-2.5 py-1.5 text-[13px]', won && 'font-semibold')}>
      {team ? <TeamCrest logoMediaId={team.logoMediaId} code={team.code} color={team.color} size={20} /> : <span className="size-5 rounded bg-surface-3" aria-hidden />}
      <span title={team?.name} className={cn('min-w-0 flex-1 truncate', !team && 'text-faint')}>{team?.name ?? source ?? (tie.state === 'bye' ? 'Bye' : '-')}</span>
      <span className="font-display text-base tabular">
        {scoreOf(tie, side)}
        {shootout !== null && shootout !== undefined && <span className="ml-1 text-xs text-muted">({shootout})</span>}
      </span>
    </div>
  )
}

function TieCard({ tie, onSchedule, manage }: { tie: BracketTieDTO; onSchedule: () => void; manage: boolean }) {
  return (
    <div className={cn('rounded-lg border bg-surface-2', tie.problem ? 'border-warning' : 'border-border')} data-testid={`tie-${tie.stage}-${tie.position}`}>
      <TieTeam tie={tie} side="home" />
      <div className="border-t border-border/70" />
      <TieTeam tie={tie} side="away" />
      {(tie.match || tie.state === 'ready') && (
        <div className="flex items-center justify-between gap-2 border-t border-border/70 px-2.5 py-1.5 text-[11px] text-muted">
          {tie.match ? (
            <Link to={`/matches/${tie.match.id}`} className="hover:text-text">
              {tie.match.matchNumber}, {fmtDateTime(tie.match.scheduledAt)}
            </Link>
          ) : (
            <span>Ready</span>
          )}
          {tie.state === 'ready' && manage && (
            <Button size="sm" variant="secondary" aria-label={`Schedule ${tie.home?.code} v ${tie.away?.code}`} onClick={onSchedule}>
              <CalendarPlus /> Schedule
            </Button>
          )}
        </div>
      )}
      {tie.problem && (
        <p className="flex gap-1.5 border-t border-warning/40 px-2.5 py-1.5 text-[11.5px] text-warning">
          <AlertTriangle className="mt-px size-3.5 shrink-0" /> {tie.problem}
        </p>
      )}
    </div>
  )
}

function BracketColumns({ bracket, manage, onSchedule }: { bracket: BracketDTO; manage: boolean; onSchedule: (t: BracketTieDTO) => void }) {
  const stages = COLUMNS.filter((s) => bracket.ties.some((t) => t.stage === s))
  const third = bracket.ties.find((t) => t.stage === 'third_place')
  return (
    <div className="overflow-x-auto px-5 py-4">
      <div className="grid min-w-max auto-cols-[230px] grid-flow-col gap-5">
        {stages.map((stage) => (
          <section key={stage} aria-label={MATCH_STAGE_LABELS[stage]} className="flex flex-col">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{MATCH_STAGE_LABELS[stage]}</h3>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {bracket.ties
                .filter((t) => t.stage === stage)
                .map((t) => (
                  <TieCard key={t.id} tie={t} manage={manage} onSchedule={() => onSchedule(t)} />
                ))}
              {stage === 'final' && third && (
                <div>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{MATCH_STAGE_LABELS.third_place}</h3>
                  <TieCard tie={third} manage={manage} onSchedule={() => onSchedule(third)} />
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

const INVALIDATE = ['knockout.', 'matches.', 'competitions.', 'seasons.', 'dashboard.']

/** The knockout rounds of a season. Everything shown is worked out from the match results. */
export function BracketPanel({ season, fromGroups, manage }: { season: SeasonDTO; fromGroups: boolean; manage: boolean }) {
  const confirm = useConfirm()
  const q = useApi('knockout.get', { seasonId: season.id }, { staleTime: 0 })
  const [creating, setCreating] = useState(false)
  const [tie, setTie] = useState<BracketTieDTO | null>(null)
  const schedule = useApiMutation('knockout.schedule', { invalidate: INVALIDATE, success: 'Fixture created', onSuccess: () => setTie(null), toastError: false })
  const clear = useApiMutation('knockout.clear', { invalidate: INVALIDATE, success: 'Bracket removed' })
  const bracket = q.data
  const hasBracket = !!bracket?.ties.length
  const unstarted = !bracket?.ties.some((t) => t.match && t.match.status !== 'scheduled' && t.match.status !== 'ready')
  const remove = async () => {
    const ok = await confirm({ title: 'Remove this bracket?', message: 'Its unplayed fixtures are deleted too.', confirmLabel: 'Remove', tone: 'danger' })
    if (ok) clear.mutate({ seasonId: season.id })
  }
  return (
    <Panel>
      <PanelHeader
        title="Knockout rounds"
        subtitle={bracket?.champion ? undefined : hasBracket ? 'Winners move on as matches are finalized.' : undefined}
        actions={
          manage &&
          (hasBracket
            ? unstarted && (
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => void remove()}>
                  <Trash2 /> Remove bracket
                </Button>
              )
            : (
                <Button size="sm" onClick={() => setCreating(true)}>
                  <GitBranch /> Create bracket
                </Button>
              ))
        }
      />
      {bracket?.champion && (
        <p className="flex items-center gap-2 border-b border-border bg-gold/10 px-5 py-2.5 text-sm font-semibold text-gold">
          <Crown className="size-4" /> Champion: {bracket.champion.name}
        </p>
      )}
      {q.isLoading ? (
        <Spinner />
      ) : hasBracket && bracket ? (
        <BracketColumns bracket={bracket} manage={manage} onSchedule={setTie} />
      ) : (
        <EmptyState icon={GitBranch} title="No bracket yet" message={fromGroups ? 'Create it once the group stage is finished.' : 'Create it to seed the teams and schedule the first round.'} />
      )}
      {creating && <CreateBracketDialog season={season} fromGroups={fromGroups} onClose={() => setCreating(false)} />}
      {tie && (
        <ScheduleTieDialog
          title={`${MATCH_STAGE_LABELS[tie.stage]}: ${tie.home?.name} v ${tie.away?.name}`}
          startDate={season.startDate}
          busy={schedule.isPending}
          error={schedule.error}
          onClose={() => setTie(null)}
          onSubmit={(scheduledAt, venueId) => schedule.mutate({ tieId: tie.id, scheduledAt, venueId })}
        />
      )}
    </Panel>
  )
}
