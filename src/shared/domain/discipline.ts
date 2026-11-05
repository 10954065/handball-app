import type { Side } from './constants'
import type { DerivedMatchState } from './ledger'
import type { RulesConfig } from './rules'
import type { RosterEntry, TeamOfficialEntry } from './types'

export type SanctionKind = 'warning' | 'suspension' | 'disqualification'

/** Where in the match the sanction is given. Affects team reductions and shoot-out eligibility. */
export type SanctionContext = 'pre_match' | 'in_play' | 'break' | 'shootout'

export type SanctionTarget = { type: 'player'; rosterId: string } | { type: 'official'; teamOfficialId: string }

export interface SanctionRequest {
  kind: SanctionKind
  side: Side
  target: SanctionTarget
  blueCard?: boolean
  context: SanctionContext
}

export interface PlannedSanctionEvent {
  type: SanctionKind
  teamReduction: boolean
  blueCard: boolean
  /** True when the event is an automatic consequence (e.g. third suspension). */
  automatic: boolean
}

export interface SanctionPlan {
  /** Hard errors: the sanction cannot be recorded. */
  errors: string[]
  /** Rule conflicts the operator must acknowledge (referees decide; HMMS records). */
  warnings: string[]
  /** Informational consequences shown to the operator. */
  notes: string[]
  events: PlannedSanctionEvent[]
  /** For suspensions: 1st, 2nd, 3rd... suspension of this person. */
  sequence: number
  reportRequired: boolean
}

/**
 * Plan the ledger events for a disciplinary decision.
 *
 * Automatic consequences are applied only where the IHF rules mandate them (third suspension
 * leads to disqualification, IHF 16:6 d). Limits that the rules describe as referee guidance
 * (warning limits, official limits) produce warnings, never silent extra punishments.
 */
export function planSanction(
  req: SanctionRequest,
  state: DerivedMatchState,
  roster: readonly RosterEntry[],
  officials: readonly TeamOfficialEntry[],
  rules: RulesConfig
): SanctionPlan {
  const plan: SanctionPlan = { errors: [], warnings: [], notes: [], events: [], sequence: 0, reportRequired: false }
  const sideRoster = roster.filter((r) => r.side === req.side)
  const sideOfficials = officials.filter((o) => o.side === req.side)
  const reduces = req.context !== 'shootout' && req.context !== 'pre_match'

  if (req.blueCard && req.kind !== 'disqualification') {
    plan.errors.push('A blue card can only accompany a disqualification (red card).')
  }

  if (req.target.type === 'player') {
    const rosterId = req.target.rosterId
    const player = sideRoster.find((r) => r.id === rosterId)
    if (!player) {
      plan.errors.push('The player is not on this team match roster.')
      return plan
    }
    if (state.disqualified.has(rosterId)) {
      plan.errors.push(`#${player.jersey} ${player.name} is already disqualified.`)
      return plan
    }
    const warnings = state.warnings.get(rosterId) ?? 0
    const suspensions = state.suspensions.get(rosterId) ?? 0

    if (req.kind === 'warning') {
      if (warnings >= rules.warnings.perPlayer) {
        plan.warnings.push(`#${player.jersey} already has ${warnings} warning(s). IHF 16:1: a player should receive only one warning.`)
      }
      if (suspensions > 0) {
        plan.warnings.push(`#${player.jersey} has already been suspended. IHF 16:1: a warning should not follow a suspension.`)
      }
      const teamWarnings = sideRoster.reduce((n, r) => n + (state.warnings.get(r.id) ?? 0), 0)
      if (teamWarnings >= rules.warnings.perTeamPlayers) {
        plan.warnings.push(`The team players already have ${teamWarnings} warnings (limit ${rules.warnings.perTeamPlayers}).`)
      }
      plan.events.push({ type: 'warning', teamReduction: false, blueCard: false, automatic: false })
    }

    if (req.kind === 'suspension') {
      plan.sequence = suspensions + 1
      plan.events.push({ type: 'suspension', teamReduction: reduces, blueCard: false, automatic: false })
      if (plan.sequence >= rules.suspension.disqualifyOnSuspensionNumber) {
        plan.events.push({ type: 'disqualification', teamReduction: false, blueCard: false, automatic: true })
        plan.notes.push(
          `Suspension number ${plan.sequence} for #${player.jersey}: automatic disqualification (IHF 16:6 d). The team is reduced for 2 minutes.`
        )
      }
      if (req.context === 'shootout') {
        plan.notes.push(`#${player.jersey} may not take part in the remainder of the shoot-out.`)
      }
    }

    if (req.kind === 'disqualification') {
      plan.events.push({ type: 'disqualification', teamReduction: reduces, blueCard: !!req.blueCard, automatic: false })
      plan.reportRequired = !!req.blueCard
      if (reduces) plan.notes.push('Disqualification: the team is reduced on court for 2 minutes (IHF 16:8).')
      if (req.context === 'pre_match') {
        plan.notes.push('Before the start of the game the team is not reduced on court. Confirm against IHF 16:8 and competition regulations.')
      }
    }
  } else {
    const officialId = req.target.teamOfficialId
    const official = sideOfficials.find((o) => o.id === officialId)
    if (!official) {
      plan.errors.push('The official is not on this team match sheet.')
      return plan
    }
    if (state.officialDisqualified.has(officialId)) {
      plan.errors.push(`Official ${official.slot} (${official.name}) is already disqualified.`)
      return plan
    }
    if (req.kind === 'warning') {
      const total = sideOfficials.reduce((n, o) => n + (state.officialWarnings.get(o.id) ?? 0), 0)
      if (total >= rules.warnings.perTeamOfficials) {
        plan.warnings.push(`The team officials already have ${total} warning(s) (limit ${rules.warnings.perTeamOfficials} in total).`)
      }
      plan.events.push({ type: 'warning', teamReduction: false, blueCard: false, automatic: false })
    }
    if (req.kind === 'suspension') {
      const total = sideOfficials.reduce((n, o) => n + (state.officialSuspensions.get(o.id) ?? 0), 0)
      plan.sequence = (state.officialSuspensions.get(officialId) ?? 0) + 1
      if (total >= rules.suspension.officialSuspensionsPerTeam) {
        plan.warnings.push(
          `The team officials have already received ${total} suspension(s) (limit ${rules.suspension.officialSuspensionsPerTeam} in total). A further offence normally leads to disqualification.`
        )
      }
      plan.events.push({ type: 'suspension', teamReduction: reduces, blueCard: false, automatic: false })
      plan.notes.push('A team official suspension reduces the team on court by one player for 2 minutes.')
    }
    if (req.kind === 'disqualification') {
      plan.events.push({ type: 'disqualification', teamReduction: reduces, blueCard: !!req.blueCard, automatic: false })
      plan.reportRequired = !!req.blueCard
      if (reduces) plan.notes.push('Official disqualification: the team is reduced on court for 2 minutes.')
    }
  }

  if (plan.reportRequired) {
    plan.notes.push('Blue card: a written report to the disciplinary body is required.')
  }
  return plan
}
