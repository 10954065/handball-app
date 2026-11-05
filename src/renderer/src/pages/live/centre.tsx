import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import type { ShotOutcome, Side } from '@shared/domain/constants'
import type { PlayKind } from '@shared/domain/live'
import type { LiveMatchDTO, LivePlayerDTO } from '@shared/dto'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorNote, Spinner } from '@/components/ui/misc'
import { useDisplayClock, useLive } from '@/lib/live'
import { useApi } from '@/lib/query'
import { useSession } from '@/lib/session'
import { abilities, ActionPanel, type EntryState, type Selection } from './action-panel'
import { MISSES, PLAYS } from './action-parts'
import { LiveModals, type Modal } from './centre-support'
import { RecoveryDialog } from './dialogs'
import { NoticeStack, useNotices } from './notices'
import { Scorebar } from './scorebar'
import { TeamBoard } from './team-board'
import { Timeline } from './timeline'
import { eventSummary, useLiveActions } from './use-live-actions'
import { useLiveKeys } from './use-live-keys'
import { useLiveSignals } from './use-live-signals'

const DEFAULT_ENTRY: EntryState = { situation: 'positional', zone: null }
const DEFAULT_PREFS = { advancedStats: true, assistPrompt: false, confirmCriticalActions: true, trackCourtPresence: true }

export function MatchCentrePage() {
  const { id = '' } = useParams()
  const q = useLive(id)
  if (q.isLoading) return <Spinner label="Loading match" className="h-full" />
  if (q.error || !q.data) {
    return (
      <div className="p-8">
        <ErrorNote error={q.error} />
      </div>
    )
  }
  if (q.data.match.status === 'scheduled') {
    return (
      <EmptyState
        className="h-full"
        icon={ClipboardList}
        title="The lineups are not confirmed yet"
        message="Both teams' match sheets must be confirmed before the match can be run."
        action={
          <Link to={`/matches/${id}/lineups`}>
            <Button>Open match sheet & lineups</Button>
          </Link>
        }
      />
    )
  }
  return <MatchCentre live={q.data} />
}

function MatchCentre({ live }: { live: LiveMatchDTO }) {
  const matchId = live.match.id
  const { can } = useSession()
  const settings = useApi('settings.get').data
  const prefs = settings?.live ?? DEFAULT_PREFS
  const operator = can('operate_match')
  const canOperate = operator && (live.match.status === 'live' || live.match.status === 'ready')
  const notices = useNotices()
  const act = useLiveActions(matchId, prefs.confirmCriticalActions, notices.push)
  const displayMs = useDisplayClock(live.clock, live.period)
  const [sel, setSel] = useState<{ side: Side; rosterId: string } | null>(null)
  const [entry, setEntry] = useState<EntryState>(DEFAULT_ENTRY)
  const [modal, setModal] = useState<Modal>(null)
  useLiveSignals(live, settings?.sound)

  const found = sel ? live[sel.side].players.find((p) => p.rosterId === sel.rosterId) : undefined
  const selection: Selection | null = sel && found ? { side: sel.side, player: found } : null
  const can_ = abilities(live, selection, prefs.trackCourtPresence)

  const recordAndConfirm = async (event: Parameters<typeof act.record>[0], benchPlayer: LivePlayerDTO | null = null) => {
    try {
      const data = await act.record(event)
      const e = data.events[0]
      notices.push({
        tone: 'success',
        text: eventSummary(e, data),
        action: e.correctable ? { label: 'Undo', onClick: () => setModal({ kind: 'void', event: e }) } : undefined
      })
      if (benchPlayer) notices.push({ tone: 'warning', text: `#${benchPlayer.jerseyNumber} ${benchPlayer.name} is shown on the bench. Check the substitutions.` })
      setSel(null)
      setEntry(DEFAULT_ENTRY)
    } catch (err) {
      act.fail(err)
    }
  }

  const shot = (outcome: ShotOutcome, s: Selection | null = selection, assistRosterId: string | null = null, askAssist = true) => {
    if (!s || !abilities(live, s, prefs.trackCourtPresence).shoot) return
    const shootout = live.period?.kind === 'shootout'
    if (outcome === 'goal' && askAssist && prefs.assistPrompt && !shootout && entry.situation !== 'seven_metre') {
      setModal({ kind: 'assist', scorer: s })
      return
    }
    const situation = shootout ? ('shootout' as const) : entry.situation
    const bench = prefs.trackCourtPresence && s.player.status === 'bench' ? s.player : null
    void recordAndConfirm({ kind: 'shot', side: s.side, rosterId: s.player.rosterId, outcome, situation, zone: entry.zone, assistRosterId }, bench)
  }

  const play = (kind: PlayKind) => {
    if (selection && can_.play) void recordAndConfirm({ kind, side: selection.side, rosterId: selection.player.rosterId })
  }

  const substitute = (other: LivePlayerDTO | null) => {
    if (!selection) return
    const off = selection.player.status === 'court'
    setModal(null)
    const [outId, inId] = off ? [selection.player.rosterId, other?.rosterId ?? null] : [other?.rosterId ?? null, selection.player.rosterId]
    void recordAndConfirm({ kind: 'substitution', side: selection.side, outRosterId: outId, inRosterId: inId })
  }

  /** Warnings and suspensions are one action; a red card opens a dialog for the blue card. */
  const sanction = (kind: 'warning' | 'suspension' | 'disqualification') => {
    if (!selection || !can_.sanction) return
    if (kind === 'disqualification') {
      setModal({ kind: 'red', side: selection.side, player: selection.player })
      return
    }
    const target = { type: 'player' as const, rosterId: selection.player.rosterId }
    void act.sanction({ kind, side: selection.side, target }).then(() => setSel(null))
  }

  const undoLast = () => {
    const last = live.events.find((e) => e.correctable)
    if (last) setModal({ kind: 'void', event: last })
    else notices.push({ tone: 'info', text: 'There is nothing to undo.' })
  }

  const typed = useLiveKeys(live, canOperate && !modal && !live.clock.needsRecovery, {
    toggleClock: () => {
      if (live.clock.phase === 'in_period' && live.period?.kind !== 'shootout' && !act.busy) void act.toggleClock(live.clock.running)
    },
    select: (side, p) => setSel({ side, rosterId: p.rosterId }),
    clear: () => setSel(null),
    undo: undoLast,
    action: (key) => {
      if (!selection || act.busy) return false
      const miss = MISSES.find((x) => x.key === key)
      const p = PLAYS.find((x) => x.key === key)
      if (key === 'G') shot('goal')
      else if (miss && (prefs.advancedStats || can_.shootout)) shot(miss.outcome)
      else if (p && prefs.advancedStats) play(p.kind)
      else if (key === 'U' && can_.substitute) setModal({ kind: 'sub' })
      else if (key === 'Y') sanction('warning')
      else if (key === 'X') sanction('suspension')
      else if (key === 'R') sanction('disqualification')
      else return false
      return true
    }
  })

  const board = (side: Side) => (
    <TeamBoard
      team={live[side]}
      selectedId={selection?.player.rosterId ?? null}
      onSelect={(p) => setSel({ side, rosterId: p.rosterId })}
      trackCourt={prefs.trackCourtPresence}
      disabled={!canOperate}
      armed={typed?.side === side}
      displayMs={displayMs}
      onOfficial={(official) => setModal({ kind: 'official', side, official })}
    />
  )

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-3 px-1 text-sm">
        <Link to={`/matches/${matchId}`} className="inline-flex items-center gap-1.5 text-muted hover:text-text">
          <ArrowLeft className="size-4" /> {live.match.matchNumber}
        </Link>
        <span className="text-faint">{live.match.competitionName ?? 'Friendly'}</span>
        {!operator && <span className="ml-auto text-xs text-faint">View only - your role cannot operate matches.</span>}
      </div>
      <Scorebar
        live={live}
        displayMs={displayMs}
        canOperate={canOperate}
        busy={act.busy}
        onStartPeriod={() => void act.startPeriod(live.nextPeriod?.label ?? '', live.match.status === 'ready')}
        onToggleClock={() => void act.toggleClock(live.clock.running)}
        onAdjustClock={() => setModal({ kind: 'clock' })}
        onEndPeriod={() => void act.endPeriod(live.period?.kind === 'shootout' ? 'shoot-out' : (live.period?.label ?? 'period'))}
        onFinish={() => void act.finish()}
        onScoreboard={() => void act.openScoreboard()}
        onTimeout={(side) => void act.timeoutStart(side)}
        onEndTimeout={() => void act.timeoutEnd()}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(340px,400px)_minmax(0,1fr)] gap-3">
        {board('home')}
        <div className="relative min-h-0">
          <div className="flex h-full flex-col gap-3 overflow-y-auto">
            {canOperate && (
            <ActionPanel
              live={live}
              selection={selection}
              entry={entry}
              onEntry={setEntry}
              onShot={(o) => shot(o)}
              onPlay={play}
              onSubstitute={() => setModal({ kind: 'sub' })}
              onSanction={sanction}
              onClear={() => setSel(null)}
              advanced={prefs.advancedStats}
              trackCourt={prefs.trackCourtPresence}
              busy={act.busy}
              typed={typed}
            />
          )}
            <Timeline live={live} onEdit={(event) => setModal({ kind: 'edit', event })} onVoid={(event) => setModal({ kind: 'void', event })} />
          </div>
          <NoticeStack items={notices.items} onDismiss={notices.dismiss} />
        </div>
        {board('away')}
      </div>
      <LiveModals
        live={live}
        modal={modal}
        setModal={setModal}
        act={act}
        selection={selection}
        displayMs={displayMs}
        trackCourt={prefs.trackCourtPresence}
        onSubstitute={substitute}
        onSanctioned={() => setSel(null)}
        onAssist={(s, a) => shot('goal', s, a, false)}
      />
      {live.clock.needsRecovery && operator && (
        <RecoveryDialog clock={live.clock} period={live.period} busy={act.busy} onResume={(ms) => void act.recover(ms)} />
      )}
    </div>
  )
}
