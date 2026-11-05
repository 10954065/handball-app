# HMMS - Handball Rules Engine

The rules engine lives in `src/shared/domain/` as pure, deterministic functions with no I/O.
Every rule below is covered by automated tests in `tests/unit/`.

**Principle:** referees make decisions; HMMS records them. HMMS applies automatic consequences
only where the IHF Rules of the Game mandate them. Where the rules give referees guidance
(for example warning limits), HMMS shows a warning the operator must acknowledge. It never
silently adds a punishment.

Reference: IHF Rules of the Game - Indoor Handball (current edition) and the IHF Electronic
Team Time-Out Regulations (July 2025). Rule numbers below follow the IHF numbering.
**Items marked VERIFY must be confirmed by the organising association** against the edition and
competition regulations it applies. All values are configurable per competition
(`RulesConfig`) and snapshotted onto each match when it is created.

## Playing time (IHF 2:1, 2:2)

| Item | Default | Status |
| --- | --- | --- |
| Senior playing time | 2 x 30 min, 15 min half-time | Verified |
| Youth 12-16 | 2 x 25 min | Preset; VERIFY with competition regulations |
| Youth 8-12 | 2 x 20 min | Preset; VERIFY with competition regulations |
| Overtime (winner required) | 5 min break, 2 x 5 min with 1 min break; up to 2 overtimes | Verified |
| Penalty shoot-out | 5 throwers per team, then sudden death | Verified |

Match time is **cumulative** (second half starts at 30:00, OT1 at 60:00), matching handball
scoreboards. Suspension carry-over between periods is therefore automatic.

The clock (`clock.ts`) derives elapsed time from a monotonic anchor and never counts ticks.
It stops automatically at the end of a period.

## Disciplinary rules (IHF 16)

| Situation | HMMS behaviour | Type |
| --- | --- | --- |
| Warning (yellow card) | Recorded. | Record |
| 2nd warning for the same player | Rule warning (IHF 16:1: one warning per player). | Acknowledge |
| Warning after a suspension | Rule warning (IHF 16:1 comment). | Acknowledge |
| 4th warning for a team players | Rule warning (max 3 per team). | Acknowledge |
| 2nd warning for team officials | Rule warning (max 1 in total). | Acknowledge |
| 2-minute suspension | Own record and timer; team reduced 2 min of playing time (16:3). | Automatic timer |
| Multiple suspensions | Independent timers, team reduction stacks. | Automatic |
| 3rd suspension of the same player | Suspension + automatic disqualification, one 2-min reduction (16:6 d). | Automatic (mandated) |
| Direct disqualification (red) | Player removed permanently; team reduced 2 min (16:8). | Automatic timer |
| Blue card | Flags a written report; no extra punishment. Only valid with a red card. | Flag |
| Official suspension | Team reduced on court for 2 min. 2nd official suspension raises a rule warning (one in total for officials). | Acknowledge |
| Official disqualification | Official removed; team reduced 2 min. | Automatic timer |
| Disqualified person sanctioned again | Rejected. | Hard error |
| Sanction during shoot-out | No team reduction (no playing time); player excluded from the rest of the shoot-out. VERIFY | Note |
| Disqualification before the game | No team reduction on court. VERIFY (IHF 16:8) | Note |
| Unsportsmanlike conduct in the last 30 s (8:10 c/d) | Referees decide; HMMS records the disqualification and 7 m. | Record |

Suspension timers count **playing time** (they stop with the match clock), as IHF 16:3 states
"two minutes of playing time". The remaining time is always recomputed from the ledger, so it
is exact after a crash or restart.

## Team time-outs (IHF 2:10, TTO regulations)

| Rule | Default |
| --- | --- |
| Per match (regular time) | 3 |
| Per half | 2 |
| Last 5 minutes of regular time | 1 |
| Overtime / shoot-out | Not permitted |
| Duration | 60 s (wall clock, the match clock is stopped) |

A faulty request (4th, 3rd in a half, 2nd in the last five minutes, any in overtime) is
refused with the reason.

## Lineups (IHF 4:1, 4:2)

- Up to 16 players on the match sheet, up to 4 team officials (A-D).
- At most 7 starters, at least 5 to start (hard limits); fewer than 7 is a warning.
- At most one starting goalkeeper, who must be a starter; none is a warning.
- Jersey numbers 1-99, unique within the team; at most one captain.
- Substitutions are unlimited (rolling); HMMS never counts them against a limit.

## Module map

| File | Responsibility |
| --- | --- |
| `rules.ts` | `RulesConfig` schema and presets |
| `periods.ts` | Period plan, cumulative time, formatting |
| `clock.ts` | Monotonic clock arithmetic |
| `ledger.ts` | Derive score, court status, sanctions and running reductions from events |
| `discipline.ts` | Plan the ledger events for a disciplinary decision |
| `timeouts.ts` | Validate team time-out requests |
| `lineup.ts` | Validate match roster and starting lineup |
