import type { RulesConfig } from './rules'

export interface LineupEntryInput {
  playerId: string
  jersey: number
  isGoalkeeper: boolean
  isStarting: boolean
  isStartingGk: boolean
  isCaptain: boolean
}

export interface LineupValidation {
  errors: string[]
  warnings: string[]
  starters: number
  startingGoalkeepers: number
}

/** Validate a team match roster and starting lineup before the match begins. */
export function validateLineup(entries: readonly LineupEntryInput[], rules: RulesConfig): LineupValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const r = rules.roster
  const starters = entries.filter((e) => e.isStarting)
  const gks = entries.filter((e) => e.isStartingGk)

  if (entries.length === 0) errors.push('No players have been entered on the match roster.')
  if (entries.length > r.maxPlayers) errors.push(`Too many players on the match roster (${entries.length}/${r.maxPlayers}).`)

  const seen = new Map<number, number>()
  for (const e of entries) {
    if (!Number.isInteger(e.jersey) || e.jersey < 1 || e.jersey > 99) errors.push(`Invalid jersey number ${e.jersey}. Use 1-99.`)
    seen.set(e.jersey, (seen.get(e.jersey) ?? 0) + 1)
  }
  for (const [num, count] of seen) if (count > 1) errors.push(`Jersey #${num} is used by ${count} players.`)

  if (starters.length > r.onCourt) errors.push(`The starting lineup has ${starters.length} players; the maximum is ${r.onCourt}.`)
  if (starters.length < r.minStarters) {
    errors.push(`At least ${r.minStarters} starting players are required (IHF 4:1).`)
  } else if (starters.length < r.onCourt) {
    warnings.push(`Only ${starters.length} of ${r.onCourt} starting players selected.`)
  }
  if (gks.length > 1) errors.push('Only one starting goalkeeper may be designated.')
  if (gks.length === 0) warnings.push('No starting goalkeeper designated.')
  for (const g of gks) if (!g.isStarting) errors.push(`The starting goalkeeper (#${g.jersey}) must be in the starting lineup.`)

  const captains = entries.filter((e) => e.isCaptain)
  if (captains.length > 1) errors.push('Only one captain may be designated.')
  if (captains.length === 0) warnings.push('No team captain designated.')

  return { errors, warnings, starters: starters.length, startingGoalkeepers: gks.length }
}
