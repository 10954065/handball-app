import type { MatchStage, MatchStatus } from './constants'

export const MAX_BRACKET_TEAMS = 16

export type BracketStage = Extract<MatchStage, 'round_of_16' | 'quarter_final' | 'semi_final' | 'third_place' | 'final'>

const ROUNDS: readonly BracketStage[] = ['round_of_16', 'quarter_final', 'semi_final', 'final']

const SHORT: Record<BracketStage, string> = { round_of_16: 'R16', quarter_final: 'QF', semi_final: 'SF', third_place: '3rd', final: 'Final' }

/** One tie as it is stored. Only first-round ties name teams; later ones are filled by results. */
export interface TieSlot {
  stage: BracketStage
  position: number
  homeTeamId: string | null
  awayTeamId: string | null
  matchId: string | null
}

/** The rounds of a bracket for this many teams, first to last. */
export function bracketRounds(teams: number): BracketStage[] {
  const size = bracketSize(teams)
  return ROUNDS.slice(ROUNDS.length - Math.log2(size))
}

/** The smallest bracket with room for this many teams. */
export const bracketSize = (teams: number): number => 2 ** Math.ceil(Math.log2(Math.max(teams, 2)))

/**
 * Seeds in bracket order, so that the top seeds can only meet late: 1, 8, 4, 5, 2, 7, 3, 6.
 * Each consecutive pair is a first-round tie.
 */
export function seedOrder(size: number): number[] {
  let order = [1]
  for (let n = 2; n <= size; n *= 2) order = order.flatMap((seed) => [seed, n + 1 - seed])
  return order
}

/** Needs two real semi-finals. With three teams, one semi-final is a bye and has no loser. */
export const hasThirdPlace = (teams: number): boolean => teams >= 4

/**
 * The ties of a new bracket from teams in seed order. When the number of teams is not a power of
 * two, the top seeds receive byes.
 */
export function buildBracket(seededTeamIds: readonly string[], thirdPlace: boolean): TieSlot[] {
  const size = bracketSize(seededTeamIds.length)
  const rounds = bracketRounds(seededTeamIds.length)
  const order = seedOrder(size)
  const team = (seed: number) => seededTeamIds[seed - 1] ?? null
  const ties: TieSlot[] = []
  rounds.forEach((stage, r) => {
    const count = size / 2 ** (r + 1)
    for (let position = 1; position <= count; position++) {
      const [home, away] = r === 0 ? [team(order[(position - 1) * 2]), team(order[(position - 1) * 2 + 1])] : [null, null]
      ties.push({ stage, position, homeTeamId: home, awayTeamId: away, matchId: null })
    }
  })
  if (thirdPlace && hasThirdPlace(seededTeamIds.length)) ties.push({ stage: 'third_place', position: 1, homeTeamId: null, awayTeamId: null, matchId: null })
  return ties
}

export interface TieMatch {
  id: string
  status: MatchStatus
  homeTeamId: string
  awayTeamId: string
  winnerSide: 'home' | 'away' | 'draw' | null
}

export type TieState = 'bye' | 'waiting' | 'ready' | 'scheduled' | 'live' | 'decided'

export interface ResolvedTie extends TieSlot {
  /** What fills an empty place, such as "Winner QF 2". */
  homeSource: string | null
  awaySource: string | null
  winnerTeamId: string | null
  loserTeamId: string | null
  state: TieState
  /** Something the competition administrator must resolve. Nothing is ever changed automatically. */
  problem: string | null
}

const label = (stage: BracketStage, position: number) => (stage === 'final' ? SHORT.final : `${SHORT[stage]} ${position}`)

interface Feeder {
  stage: BracketStage
  position: number
  take: 'winner' | 'loser'
}

/** Where the two teams of a tie come from. The first round has no feeders. */
function feeders(tie: Pick<TieSlot, 'stage' | 'position'>): [Feeder, Feeder] | null {
  if (tie.stage === 'third_place') {
    return [
      { stage: 'semi_final', position: 1, take: 'loser' },
      { stage: 'semi_final', position: 2, take: 'loser' }
    ]
  }
  const index = ROUNDS.indexOf(tie.stage)
  if (index === 0) return null
  const stage = ROUNDS[index - 1]
  return [
    { stage, position: tie.position * 2 - 1, take: 'winner' },
    { stage, position: tie.position * 2, take: 'winner' }
  ]
}

const describeFeeder = (f: Feeder) => `${f.take === 'winner' ? 'Winner' : 'Loser'} ${label(f.stage, f.position)}`

const STATE_OF: Partial<Record<MatchStatus, TieState>> = { scheduled: 'scheduled', ready: 'scheduled', live: 'live' }

function settle(home: string | null, away: string | null, match: TieMatch | undefined, isFirstRound: boolean) {
  if (!match) {
    if (home && away) return { state: 'ready' as const, winnerTeamId: null, loserTeamId: null, problem: null }
    const bye = isFirstRound && !!(home || away)
    return { state: bye ? ('bye' as const) : ('waiting' as const), winnerTeamId: bye ? (home ?? away) : null, loserTeamId: null, problem: null }
  }
  if (match.homeTeamId !== home || match.awayTeamId !== away) {
    const problem =
      match.status === 'scheduled' || match.status === 'ready'
        ? 'The teams of this fixture no longer match the bracket, because an earlier result was corrected. Delete this fixture and schedule the tie again.'
        : 'This match no longer matches the bracket, because an earlier result was corrected. Its result stands, and this tie stays unresolved until the competition decides what happens.'
    return { state: STATE_OF[match.status] ?? ('decided' as const), winnerTeamId: null, loserTeamId: null, problem }
  }
  if (match.status !== 'finished') return { state: STATE_OF[match.status] ?? ('scheduled' as const), winnerTeamId: null, loserTeamId: null, problem: null }
  if (match.winnerSide !== 'home' && match.winnerSide !== 'away') {
    return { state: 'decided' as const, winnerTeamId: null, loserTeamId: null, problem: 'This match finished level, so no team can advance.' }
  }
  const [winnerTeamId, loserTeamId] = match.winnerSide === 'home' ? [match.homeTeamId, match.awayTeamId] : [match.awayTeamId, match.homeTeamId]
  return { state: 'decided' as const, winnerTeamId, loserTeamId, problem: null }
}

const ORDER: readonly BracketStage[] = ['round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final']

/**
 * Work out the whole bracket from its ties and their matches. Nothing here is stored, so a
 * correction to a finalized match reaches every later round by itself.
 */
export function resolveBracket(ties: readonly TieSlot[], matches: readonly TieMatch[]): ResolvedTie[] {
  const byId = new Map(matches.map((m) => [m.id, m]))
  const done = new Map<string, ResolvedTie>()
  const key = (stage: BracketStage, position: number) => `${stage}:${position}`
  const firstRound = ORDER.find((s) => ties.some((t) => t.stage === s))
  const ordered = [...ties].sort((a, b) => ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage) || a.position - b.position)
  for (const tie of ordered) {
    const from = tie.stage === firstRound ? null : feeders(tie)
    const teamFrom = (f: Feeder) => {
      const prior = done.get(key(f.stage, f.position))
      return (f.take === 'winner' ? prior?.winnerTeamId : prior?.loserTeamId) ?? null
    }
    const home = from ? teamFrom(from[0]) : tie.homeTeamId
    const away = from ? teamFrom(from[1]) : tie.awayTeamId
    const match = tie.matchId ? byId.get(tie.matchId) : undefined
    done.set(key(tie.stage, tie.position), {
      ...tie,
      homeTeamId: home,
      awayTeamId: away,
      homeSource: from ? describeFeeder(from[0]) : null,
      awaySource: from ? describeFeeder(from[1]) : null,
      ...settle(home, away, match, !from)
    })
  }
  return ordered.map((t) => done.get(key(t.stage, t.position)) as ResolvedTie)
}
