import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ScanEye, X } from 'lucide-react'
import { SHOT_OUTCOME_LABELS, SHOT_OUTCOMES, type ShotOutcome, type Side } from '@shared/domain/constants'
import { formatMatchTime } from '@shared/domain/periods'
import type { LiveMatchDTO } from '@shared/dto'
import { SUGGESTION_LABELS, type SuggestionDTO } from '@shared/vision'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { ErrorNote } from '@/components/ui/misc'
import { subscribe } from '@/lib/api'
import { useApi, useApiMutation } from '@/lib/query'

function usePendingSuggestions(matchId: string) {
  const qc = useQueryClient()
  const list = useApi('suggestions.list', { matchId, status: 'pending' }, { staleTime: 0 })
  useEffect(() => subscribe('suggestions.changed', (p) => {
    if (p.matchId === matchId) void qc.invalidateQueries({ queryKey: ['suggestions.list'] })
  }), [matchId, qc])
  return list.data ?? []
}

const percent = (confidence: number) => `${Math.round(confidence * 100)}%`

/** "1:23" to milliseconds. Null when it cannot be read. */
function parseTime(text: string): number | null {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(text.trim())
  return match ? (Number(match[1]) * 60 + Number(match[2])) * 1000 : null
}

function ConfirmDialog({ suggestion, live, onClose }: { suggestion: SuggestionDTO; live: LiveMatchDTO; onClose: () => void }) {
  const [side, setSide] = useState<Side | ''>(suggestion.side ?? '')
  const [rosterId, setRosterId] = useState(suggestion.rosterId ?? '')
  const [outcome, setOutcome] = useState<ShotOutcome | ''>(suggestion.category === 'goal' ? 'goal' : suggestion.category === 'save' ? 'saved' : '')
  const [time, setTime] = useState(formatMatchTime(suggestion.matchMs))
  const confirm = useApiMutation('suggestions.confirm', { invalidate: ['suggestions.'], success: 'Recorded', onSuccess: onClose, toastError: false })
  const matchMs = parseTime(time)
  const players = side ? live[side].players : []
  const ready = !!side && !!rosterId && !!outcome && matchMs !== null

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={SUGGESTION_LABELS[suggestion.category]}
      description="Check this against what happened on court. Nothing is recorded until you confirm."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!ready} loading={confirm.isPending} onClick={() => confirm.mutate({ id: suggestion.id, side: side || null, rosterId: rosterId || null, outcome: outcome || undefined, matchMs: matchMs ?? undefined })}>
            Record event
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Team" htmlFor="ai-side" required>
          <Select id="ai-side" value={side} onChange={(e) => { setSide(e.target.value as Side); setRosterId('') }}>
            <option value="">Choose</option>
            <option value="home">{live.home.name}</option>
            <option value="away">{live.away.name}</option>
          </Select>
        </Field>
        <Field label="Match time" htmlFor="ai-time" required>
          <Input id="ai-time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label={suggestion.category === 'save' ? 'Player who shot' : 'Scorer'} htmlFor="ai-player" required className="col-span-2">
          <Select id="ai-player" value={rosterId} disabled={!side} onChange={(e) => setRosterId(e.target.value)}>
            <option value="">{side ? 'Choose the player' : 'Choose the team first'}</option>
            {players.map((p) => <option key={p.rosterId} value={p.rosterId}>#{p.jerseyNumber} {p.name}</option>)}
          </Select>
        </Field>
        <Field label="Outcome" htmlFor="ai-outcome" required className="col-span-2">
          <Select id="ai-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as ShotOutcome)}>
            <option value="">Choose</option>
            {SHOT_OUTCOMES.map((o) => <option key={o} value={o}>{SHOT_OUTCOME_LABELS[o]}</option>)}
          </Select>
        </Field>
      </div>
      {!!confirm.error && <div className="mt-3"><ErrorNote error={confirm.error} /></div>}
    </Dialog>
  )
}

function SuggestionRow({ suggestion, live, onReview }: { suggestion: SuggestionDTO; live: LiveMatchDTO; onReview: () => void }) {
  const reject = useApiMutation('suggestions.reject', { invalidate: ['suggestions.'] })
  const team = suggestion.side ? live[suggestion.side].name : 'Team unknown'
  const player = suggestion.side && suggestion.rosterId ? live[suggestion.side].players.find((p) => p.rosterId === suggestion.rosterId) : undefined
  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[13px] font-semibold">{SUGGESTION_LABELS[suggestion.category]}</p>
        <p className="truncate text-xs text-muted">
          <span className="tabular">{formatMatchTime(suggestion.matchMs)}</span>, {team}, {player ? `#${player.jerseyNumber} ${player.name}` : 'Unknown player'}
        </p>
      </div>
      <Badge tone="neutral" title="How sure the AI is. This is not proof.">{percent(suggestion.confidence)}</Badge>
      <Button size="sm" onClick={onReview} aria-label={`Review ${SUGGESTION_LABELS[suggestion.category]} at ${formatMatchTime(suggestion.matchMs)}`}><Check /> Review</Button>
      <Button size="sm" variant="ghost" loading={reject.isPending} aria-label={`Reject ${SUGGESTION_LABELS[suggestion.category]} at ${formatMatchTime(suggestion.matchMs)}`} onClick={() => reject.mutate({ id: suggestion.id, reason: null })}><X /></Button>
    </li>
  )
}

/** Appears only when something is waiting, and leaves the match controls and shortcuts alone. */
export function ReviewQueue({ live }: { live: LiveMatchDTO }) {
  const pending = usePendingSuggestions(live.match.id)
  const [reviewing, setReviewing] = useState<SuggestionDTO | null>(null)
  if (!pending.length) return null
  return (
    <section aria-label="AI suggestions" className="rounded-xl border border-timeout/40 bg-surface-1">
      <h3 className="flex items-center gap-2 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <ScanEye className="size-3.5" /> AI suggestions, not official until confirmed
      </h3>
      <ul className="max-h-48 divide-y divide-border overflow-y-auto">
        {pending.map((s) => <SuggestionRow key={s.id} suggestion={s} live={live} onReview={() => setReviewing(s)} />)}
      </ul>
      {reviewing && <ConfirmDialog suggestion={reviewing} live={live} onClose={() => setReviewing(null)} />}
    </section>
  )
}
