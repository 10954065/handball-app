import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LiveMatchDTO } from '../../src/shared/dto'
import type { SuggestionDTO } from '../../src/shared/vision'
import { ReviewQueue } from '@/pages/live/review-queue'
import { invoke } from './setup'

const ROSTER = '22222222-2222-4222-8222-222222222222'
const ID = '11111111-1111-4111-8111-111111111111'

const player = { rosterId: ROSTER, jerseyNumber: 9, name: 'Kofi Mensah' }
const live = {
  match: { id: 'match' },
  home: { name: 'Accra Lions', players: [player] },
  away: { name: 'Kumasi Royals', players: [] }
} as unknown as LiveMatchDTO

const suggestion: SuggestionDTO = {
  id: ID, matchId: 'match', category: 'goal', side: 'home', rosterId: null, jersey: null, trackId: 7, confidence: 0.82, cameraId: null, periodSeq: 1, matchMs: 83_000, evidence: null,
  status: 'pending', eventId: null, correction: null, reason: null, decidedBy: null, decidedAt: null, createdAt: 0, eventVoided: false
}

function answer(pending: SuggestionDTO[]) {
  invoke.mockImplementation(async (channel: string) => ({ ok: true, data: channel === 'suggestions.list' ? pending : null }))
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ReviewQueue live={live} /></QueryClientProvider>)
}

const calls = (channel: string) => invoke.mock.calls.filter(([c]) => c === channel)

describe('the AI review queue', () => {
  beforeEach(() => answer([suggestion]))

  it('stays out of the way when nothing is waiting', async () => {
    answer([])
    show()
    await waitFor(() => expect(calls('suggestions.list')).toHaveLength(1))
    expect(screen.queryByRole('region', { name: 'AI suggestions' })).not.toBeInTheDocument()
  })

  it('says plainly that a suggestion is not official', async () => {
    show()
    const queue = await screen.findByRole('region', { name: 'AI suggestions' })
    expect(queue).toHaveTextContent('not official until confirmed')
    expect(queue).toHaveTextContent('Possible goal')
    expect(queue).toHaveTextContent('Accra Lions')
    expect(queue).toHaveTextContent('82%')
  })

  it('shows an unidentified player as unknown, and never guesses', async () => {
    show()
    expect(await screen.findByRole('region', { name: 'AI suggestions' })).toHaveTextContent('Unknown player')
  })

  it('names the player only when the suggestion identified one', async () => {
    answer([{ ...suggestion, rosterId: ROSTER }])
    show()
    expect(await screen.findByRole('region', { name: 'AI suggestions' })).toHaveTextContent('#9 Kofi Mensah')
  })

  it('will not record an event until a player is chosen', async () => {
    show()
    await userEvent.click(await screen.findByRole('button', { name: /^Review/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Record event' })).toBeDisabled()
    await userEvent.selectOptions(within(dialog).getByLabelText(/Scorer/), ROSTER)
    expect(within(dialog).getByRole('button', { name: 'Record event' })).toBeEnabled()
  })

  it('records nothing until the official confirms', async () => {
    show()
    await userEvent.click(await screen.findByRole('button', { name: /^Review/ }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(calls('suggestions.confirm')).toEqual([])
  })

  it('sends what the official chose, including a corrected time', async () => {
    show()
    await userEvent.click(await screen.findByRole('button', { name: /^Review/ }))
    const dialog = screen.getByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText(/Scorer/), ROSTER)
    const time = within(dialog).getByLabelText(/Match time/)
    await userEvent.clear(time)
    await userEvent.type(time, '1:20')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record event' }))
    await waitFor(() => expect(calls('suggestions.confirm')).toHaveLength(1))
    expect(calls('suggestions.confirm')[0][1]).toEqual({ id: ID, side: 'home', rosterId: ROSTER, outcome: 'goal', matchMs: 80_000 })
  })

  it('refuses a time it cannot read', async () => {
    show()
    await userEvent.click(await screen.findByRole('button', { name: /^Review/ }))
    const dialog = screen.getByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText(/Scorer/), ROSTER)
    const time = within(dialog).getByLabelText(/Match time/)
    await userEvent.clear(time)
    await userEvent.type(time, 'soon')
    expect(within(dialog).getByRole('button', { name: 'Record event' })).toBeDisabled()
  })

  it('clears the player when the team changes, so a name cannot cross teams', async () => {
    answer([{ ...suggestion, rosterId: ROSTER }])
    show()
    await userEvent.click(await screen.findByRole('button', { name: /^Review/ }))
    const dialog = screen.getByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText(/Team/), 'away')
    expect(within(dialog).getByRole('button', { name: 'Record event' })).toBeDisabled()
  })

  it('rejects in one click', async () => {
    show()
    await userEvent.click(await screen.findByRole('button', { name: /^Reject/ }))
    await waitFor(() => expect(calls('suggestions.reject')).toHaveLength(1))
    expect(calls('suggestions.reject')[0][1]).toEqual({ id: ID, reason: null })
    expect(calls('suggestions.confirm')).toEqual([])
  })

  it('shows why the match engine refused an event', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'suggestions.confirm') return { ok: false, error: { code: 'RULE_VIOLATION', message: '#9 Kofi Mensah is serving a suspension.' } }
      return { ok: true, data: channel === 'suggestions.list' ? [suggestion] : null }
    })
    show()
    await userEvent.click(await screen.findByRole('button', { name: /^Review/ }))
    const dialog = screen.getByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText(/Scorer/), ROSTER)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record event' }))
    expect(await within(dialog).findByText(/serving a suspension/)).toBeInTheDocument()
  })
})
