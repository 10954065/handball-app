export type TiebreakerKey =
  | 'points'
  | 'head_to_head_points'
  | 'head_to_head_goal_difference'
  | 'head_to_head_goals'
  | 'goal_difference'
  | 'goals_for'
  | 'wins'

export interface StandingsConfig {
  pointsWin: number
  pointsDraw: number
  pointsLoss: number
  tiebreakers: readonly string[]
}

/** A finalized result. Shoot-out winners are passed as winnerSide; goals exclude shoot-out goals. */
export interface ResultInput {
  homeTeamId: string
  awayTeamId: string
  homeScore: number
  awayScore: number
  winnerSide: 'home' | 'away' | 'draw'
}

export interface StandingRow {
  teamId: string
  groupName: string
  rank: number
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
}

interface Acc {
  played: number
  won: number
  drawn: number
  lost: number
  gf: number
  ga: number
  pts: number
}

const blank = (): Acc => ({ played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 })

function tabulate(teamIds: Iterable<string>, results: readonly ResultInput[], cfg: StandingsConfig): Map<string, Acc> {
  const t = new Map<string, Acc>()
  for (const id of teamIds) t.set(id, blank())
  for (const r of results) {
    const h = t.get(r.homeTeamId)
    const a = t.get(r.awayTeamId)
    if (!h || !a) continue
    h.played++
    a.played++
    h.gf += r.homeScore
    h.ga += r.awayScore
    a.gf += r.awayScore
    a.ga += r.homeScore
    if (r.winnerSide === 'home') {
      h.won++, a.lost++, (h.pts += cfg.pointsWin), (a.pts += cfg.pointsLoss)
    } else if (r.winnerSide === 'away') {
      a.won++, h.lost++, (a.pts += cfg.pointsWin), (h.pts += cfg.pointsLoss)
    } else {
      h.drawn++, a.drawn++, (h.pts += cfg.pointsDraw), (a.pts += cfg.pointsDraw)
    }
  }
  return t
}

function metric(key: string, id: string, overall: Map<string, Acc>, h2h: Map<string, Acc>): number {
  const o = overall.get(id)!
  const m = h2h.get(id)!
  switch (key) {
    case 'points':
      return o.pts
    case 'head_to_head_points':
      return m.pts
    case 'head_to_head_goal_difference':
      return m.gf - m.ga
    case 'head_to_head_goals':
      return m.gf
    case 'goal_difference':
      return o.gf - o.ga
    case 'goals_for':
      return o.gf
    case 'wins':
      return o.won
    default:
      return 0
  }
}

/** Order a set of teams tied on everything before criterion index `from`. */
function breakTie(ids: string[], from: number, overall: Map<string, Acc>, results: readonly ResultInput[], cfg: StandingsConfig, names: Map<string, string>): string[] {
  if (ids.length <= 1) return ids
  if (from >= cfg.tiebreakers.length) return [...ids].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b))
  const set = new Set(ids)
  const h2h = tabulate(ids, results.filter((r) => set.has(r.homeTeamId) && set.has(r.awayTeamId)), cfg)
  const key = cfg.tiebreakers[from]
  const buckets = new Map<number, string[]>()
  for (const id of ids) {
    const v = metric(key, id, overall, h2h)
    buckets.set(v, [...(buckets.get(v) ?? []), id])
  }
  return [...buckets.entries()].sort((a, b) => b[0] - a[0]).flatMap(([, group]) => breakTie(group, from + 1, overall, results, cfg, names))
}

/**
 * Compute standings from finalized results only. Teams are ranked within their group by the
 * configured criteria in order; head-to-head criteria are evaluated among the tied teams only.
 */
export function computeStandings(
  teams: readonly { teamId: string; groupName: string | null; name?: string }[],
  results: readonly ResultInput[],
  cfg: StandingsConfig
): StandingRow[] {
  const names = new Map(teams.map((t) => [t.teamId, t.name ?? t.teamId]))
  const groups = new Map<string, string[]>()
  for (const t of teams) groups.set(t.groupName ?? '', [...(groups.get(t.groupName ?? '') ?? []), t.teamId])
  const criteria = cfg.tiebreakers[0] === 'points' ? cfg : { ...cfg, tiebreakers: ['points', ...cfg.tiebreakers] }
  const rows: StandingRow[] = []
  for (const [groupName, ids] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const set = new Set(ids)
    const groupResults = results.filter((r) => set.has(r.homeTeamId) && set.has(r.awayTeamId))
    const overall = tabulate(ids, groupResults, criteria)
    breakTie(ids, 0, overall, groupResults, criteria, names).forEach((id, i) => {
      const a = overall.get(id)!
      rows.push({
        teamId: id,
        groupName,
        rank: i + 1,
        played: a.played,
        won: a.won,
        drawn: a.drawn,
        lost: a.lost,
        goalsFor: a.gf,
        goalsAgainst: a.ga,
        goalDifference: a.gf - a.ga,
        points: a.pts
      })
    })
  }
  return rows
}
