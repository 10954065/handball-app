export interface Pairing {
  homeTeamId: string
  awayTeamId: string
}

/**
 * Round-robin by the circle method: one team stays fixed while the others rotate. An odd number of
 * teams gets a bye each round. A team's home and away matches differ by at most one per leg.
 * A second leg repeats the rounds with home and away reversed.
 */
export function roundRobin(teamIds: readonly string[], legs: 1 | 2 = 1): Pairing[][] {
  // With an odd number of teams the bye is the fixed point, which keeps every team exactly balanced.
  const ring: (string | null)[] = teamIds.length % 2 ? [null, ...teamIds] : [...teamIds]
  const n = ring.length
  const [fixed, ...rest] = ring
  const rounds: Pairing[][] = []
  for (let r = 0; r < n - 1; r++) {
    const rotated = [fixed, ...rest.slice(r), ...rest.slice(0, r)]
    const round: Pairing[] = []
    for (let i = 0; i < n / 2; i++) {
      const [a, b] = [rotated[i], rotated[n - 1 - i]]
      if (a === null || b === null) continue
      // The fixed team never moves, so it alternates; the rotating teams balance by themselves.
      const swap = i === 0 && r % 2 === 1
      round.push(swap ? { homeTeamId: b as string, awayTeamId: a as string } : { homeTeamId: a as string, awayTeamId: b as string })
    }
    rounds.push(round)
  }
  if (legs === 1) return rounds
  return [...rounds, ...rounds.map((round) => round.map((p) => ({ homeTeamId: p.awayTeamId, awayTeamId: p.homeTeamId })))]
}

export interface FixtureGroup {
  groupName: string | null
  teamIds: readonly string[]
}

export interface ScheduleOptions {
  legs: 1 | 2
  /** The first match of the first round. */
  firstKickoff: number
  daysBetweenRounds: number
  /** Time between matches on one match day. */
  minutesBetweenMatches: number
}

export interface PlannedFixture extends Pairing {
  round: number
  groupName: string | null
  scheduledAt: number
}

const MINUTE_MS = 60_000

/** The same local time a number of calendar days later, so a clock change never moves a throw-off. */
function daysLater(at: number, days: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes()).getTime()
}

/** Fixtures for every group. Groups play the same round on the same day, one match after another. */
export function planFixtures(groups: readonly FixtureGroup[], o: ScheduleOptions): PlannedFixture[] {
  const perGroup = groups.map((g) => ({ groupName: g.groupName, rounds: roundRobin(g.teamIds, o.legs) }))
  const roundCount = Math.max(0, ...perGroup.map((g) => g.rounds.length))
  const fixtures: PlannedFixture[] = []
  for (let r = 0; r < roundCount; r++) {
    const day = daysLater(o.firstKickoff, r * o.daysBetweenRounds)
    const round = perGroup.flatMap((g) => (g.rounds[r] ?? []).map((p) => ({ ...p, groupName: g.groupName })))
    round.forEach((p, slot) => fixtures.push({ ...p, round: r + 1, scheduledAt: day + slot * o.minutesBetweenMatches * MINUTE_MS }))
  }
  return fixtures
}

export interface TeamInGroup {
  teamId: string
  groupName: string | null
}

/** Sort a season's teams into the groups that play each other, or say what is missing. */
export function fixtureGroups(teams: readonly TeamInGroup[], grouped: boolean): { groups: FixtureGroup[]; problem: string | null } {
  if (!grouped) {
    const problem = teams.length < 2 ? 'Register at least two teams first.' : null
    return { groups: [{ groupName: null, teamIds: teams.map((t) => t.teamId) }], problem }
  }
  if (teams.some((t) => !t.groupName)) return { groups: [], problem: 'Give every team a group first, under Manage teams.' }
  const names = [...new Set(teams.map((t) => t.groupName as string))].sort()
  const groups = names.map((groupName) => ({ groupName, teamIds: teams.filter((t) => t.groupName === groupName).map((t) => t.teamId) }))
  const small = groups.find((g) => g.teamIds.length < 2)
  if (!groups.length) return { groups, problem: 'Register at least two teams first.' }
  return { groups, problem: small ? `Group ${small.groupName} needs at least two teams.` : null }
}
