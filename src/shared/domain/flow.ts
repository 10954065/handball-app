import type { Side } from './constants'
import type { PeriodDef } from './periods'
import type { RulesConfig } from './rules'
import type { LedgerEvent } from './types'

export interface Score {
  home: number
  away: number
}

/**
 * The period that follows `ended`, given the score at the end of it (regular + overtime goals,
 * shoot-out goals excluded). Returns null when the match is over.
 *
 * IHF 2:2: when a winner is required and the score is level after regular time, two overtime
 * halves of 5 minutes are played; if still level, a second overtime; then a penalty shoot-out.
 */
export function nextPeriod(plan: readonly PeriodDef[], ended: PeriodDef, score: Score, rules: RulesConfig): PeriodDef | null {
  const level = score.home === score.away
  const firstOf = (ot: number) => plan.find((p) => p.kind === 'overtime' && p.overtime === ot)
  const shootout = () => plan.find((p) => p.kind === 'shootout') ?? null

  if (ended.kind === 'shootout') return null
  if (ended.kind === 'regular') {
    if (ended.seq === 1) return plan.find((p) => p.seq === 2) ?? null
    if (!level || rules.drawAllowed) return null
    return firstOf(1) ?? shootout()
  }
  // Overtime: the first half of an overtime is always followed by its second half.
  const second = plan.find((p) => p.kind === 'overtime' && p.overtime === ended.overtime && p.seq > ended.seq)
  if (second) return second
  if (!level) return null
  return firstOf((ended.overtime ?? 0) + 1) ?? shootout()
}

export interface ShootoutSide {
  attempts: number
  goals: number
}

export interface ShootoutStatus {
  home: ShootoutSide
  away: ShootoutSide
  /** Throws per team before sudden death. */
  roundLength: number
  suddenDeath: boolean
  decided: boolean
  winner: Side | null
  /** The team that must throw next when one team is a throw ahead, otherwise null. */
  nextSide: Side | null
}

/**
 * Penalty shoot-out progress (IHF 2:2). Five throws per team; if still level, sudden death in
 * pairs. The shoot-out is decided as soon as one team can no longer be caught.
 */
export function shootoutStatus(events: readonly LedgerEvent[], rules: RulesConfig): ShootoutStatus {
  const n = rules.shootout.throwsPerTeam
  const tally = (side: Side): ShootoutSide => {
    const throws = events.filter((e) => e.status === 'active' && e.type === 'shot' && e.situation === 'shootout' && e.side === side)
    return { attempts: throws.length, goals: throws.filter((e) => e.outcome === 'goal').length }
  }
  const home = tally('home')
  const away = tally('away')
  const nextSide: Side | null = home.attempts > away.attempts ? 'away' : away.attempts > home.attempts ? 'home' : null
  let winner: Side | null = null
  if (home.attempts <= n && away.attempts <= n) {
    if (home.goals > away.goals + (n - away.attempts)) winner = 'home'
    else if (away.goals > home.goals + (n - home.attempts)) winner = 'away'
  } else if (home.attempts === away.attempts && home.goals !== away.goals) {
    winner = home.goals > away.goals ? 'home' : 'away'
  }
  const suddenDeath = home.attempts > n || away.attempts > n || (home.attempts === n && away.attempts === n && !winner)
  return { home, away, roundLength: n, suddenDeath, decided: winner !== null, winner, nextSide }
}

export type DecidedBy = 'regular' | 'overtime' | 'shootout'

export interface MatchResult {
  homeScore: number
  awayScore: number
  homeShootout: number | null
  awayShootout: number | null
  winnerSide: Side | 'draw'
  decidedBy: DecidedBy
}

/** Final result from the score after play, the last period played and the shoot-out (if any). */
export function matchResult(score: Score, lastPlayed: PeriodDef, shootout: ShootoutStatus | null): MatchResult {
  if (lastPlayed.kind === 'shootout' && shootout) {
    return {
      homeScore: score.home,
      awayScore: score.away,
      homeShootout: shootout.home.goals,
      awayShootout: shootout.away.goals,
      winnerSide: shootout.winner ?? 'draw',
      decidedBy: 'shootout'
    }
  }
  return {
    homeScore: score.home,
    awayScore: score.away,
    homeShootout: null,
    awayShootout: null,
    winnerSide: score.home > score.away ? 'home' : score.away > score.home ? 'away' : 'draw',
    decidedBy: lastPlayed.kind === 'overtime' ? 'overtime' : 'regular'
  }
}
