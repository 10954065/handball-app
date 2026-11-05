import { z } from 'zod'

/**
 * Competition rule configuration. A copy of this object is snapshotted onto every match at
 * creation time so later edits to a competition never alter how a historical match was run.
 *
 * Defaults follow the IHF Rules of the Game (Indoor Handball). See HANDBALL_RULES_ENGINE.md
 * for the rule references and the items that must be confirmed against the organising
 * association regulations.
 */
export const rulesConfigSchema = z.object({
  presetId: z.string().min(1).max(40),
  presetName: z.string().min(1).max(80),
  /** Length of each regular period (half) in minutes. IHF 2:1 — seniors 2 x 30. */
  periodMinutes: z.number().int().min(5).max(45),
  /** Number of regular periods. Handball uses two halves. */
  regularPeriods: z.literal(2),
  /** Half-time break in minutes. IHF 2:1 — normally 15. */
  halfTimeBreakMinutes: z.number().int().min(0).max(30),
  /** Whether a drawn result is a valid final result (league) or a winner must be found (knockout). */
  drawAllowed: z.boolean(),
  overtime: z.object({
    enabled: z.boolean(),
    /** IHF 2:2 — overtime halves are 2 x 5 minutes. */
    periodMinutes: z.number().int().min(1).max(15),
    breakBeforeMinutes: z.number().int().min(0).max(15),
    breakBetweenMinutes: z.number().int().min(0).max(5),
    /** IHF 2:2 — up to two overtimes before the penalty shoot-out. */
    maxOvertimes: z.number().int().min(0).max(3)
  }),
  shootout: z.object({
    enabled: z.boolean(),
    /** IHF 2:2 — five throwers per team, then sudden death. */
    throwsPerTeam: z.number().int().min(1).max(10)
  }),
  suspension: z.object({
    /** IHF 16:3 — a suspension is always two minutes of playing time. */
    durationSeconds: z.number().int().min(30).max(300),
    /** IHF 16:6 d — the third suspension of the same player leads to disqualification. */
    disqualifyOnSuspensionNumber: z.number().int().min(2).max(5),
    /** IHF 16:3 — team officials may receive one suspension in total. */
    officialSuspensionsPerTeam: z.number().int().min(0).max(4)
  }),
  warnings: z.object({
    /** IHF 16:1 comment — a player should receive no more than one warning. */
    perPlayer: z.number().int().min(0).max(3),
    /** IHF 16:1 comment — no more than three warnings in total for the players of a team. */
    perTeamPlayers: z.number().int().min(0).max(10),
    /** IHF 16:1 comment — no more than one warning in total for the team officials. */
    perTeamOfficials: z.number().int().min(0).max(4)
  }),
  timeouts: z.object({
    /** IHF 2:10 / TTO regulations — three team time-outs per match in regular playing time. */
    perMatch: z.number().int().min(0).max(6),
    /** Not more than two in each half. */
    perHalf: z.number().int().min(0).max(6),
    /** Only one per team in the last five minutes of regular playing time. */
    inFinalWindow: z.number().int().min(0).max(6),
    finalWindowMinutes: z.number().int().min(0).max(15),
    durationSeconds: z.number().int().min(30).max(180),
    /** IHF — no team time-outs in overtime. */
    allowedInOvertime: z.boolean()
  }),
  roster: z.object({
    /** IHF 4:1 — up to 16 players may be entered on the match sheet. */
    maxPlayers: z.number().int().min(7).max(20),
    /** IHF 4:2 — up to four team officials. */
    maxOfficials: z.number().int().min(0).max(6),
    /** Players on court at the same time (IHF 4:1 — seven). */
    onCourt: z.number().int().min(5).max(7),
    /** IHF 4:1 — a team must have at least five players on court to start. */
    minStarters: z.number().int().min(1).max(7)
  })
})

export type RulesConfig = z.infer<typeof rulesConfigSchema>

const base: Omit<RulesConfig, 'presetId' | 'presetName' | 'periodMinutes' | 'halfTimeBreakMinutes'> = {
  regularPeriods: 2,
  drawAllowed: true,
  overtime: { enabled: true, periodMinutes: 5, breakBeforeMinutes: 5, breakBetweenMinutes: 1, maxOvertimes: 2 },
  shootout: { enabled: true, throwsPerTeam: 5 },
  suspension: { durationSeconds: 120, disqualifyOnSuspensionNumber: 3, officialSuspensionsPerTeam: 1 },
  warnings: { perPlayer: 1, perTeamPlayers: 3, perTeamOfficials: 1 },
  timeouts: {
    perMatch: 3,
    perHalf: 2,
    inFinalWindow: 1,
    finalWindowMinutes: 5,
    durationSeconds: 60,
    allowedInOvertime: false
  },
  roster: { maxPlayers: 16, maxOfficials: 4, onCourt: 7, minStarters: 5 }
}

export const RULE_PRESETS: readonly RulesConfig[] = [
  { ...base, presetId: 'ihf_senior', presetName: 'IHF Senior (2 x 30 min)', periodMinutes: 30, halfTimeBreakMinutes: 15 },
  {
    ...base,
    presetId: 'ihf_senior_knockout',
    presetName: 'IHF Senior Knockout (winner required)',
    periodMinutes: 30,
    halfTimeBreakMinutes: 15,
    drawAllowed: false
  },
  { ...base, presetId: 'youth_u18', presetName: 'Youth 16+ (2 x 30 min)', periodMinutes: 30, halfTimeBreakMinutes: 10 },
  { ...base, presetId: 'youth_u16', presetName: 'Youth 12-16 (2 x 25 min)', periodMinutes: 25, halfTimeBreakMinutes: 10 },
  { ...base, presetId: 'youth_u12', presetName: 'Youth 8-12 (2 x 20 min)', periodMinutes: 20, halfTimeBreakMinutes: 10 }
]

export const DEFAULT_RULES: RulesConfig = RULE_PRESETS[0]

export function findPreset(id: string): RulesConfig | undefined {
  return RULE_PRESETS.find((p) => p.presetId === id)
}
