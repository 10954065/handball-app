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

### Period flow (`flow.ts`)

| After | Next |
| --- | --- |
| First half | Second half |
| Second half, winner decided or a draw allowed | Match can be finished |
| Second half, level and a winner required | First overtime; if overtime is disabled, shoot-out |
| First half of an overtime | Its second half, whatever the score |
| Second half of an overtime, level | Next overtime, then shoot-out |
| Shoot-out | Match can be finished |

If a winner is required, the match is level and no overtime or shoot-out is configured, HMMS
asks for confirmation before finishing it as a draw.

Players suspended or disqualified at the end of playing time may not take part in the shoot-out
(IHF 2:2 comment), and a player suspended during it takes no further part.

The shoot-out runs without the match clock. Teams throw alternately. It is decided as soon as
one team can no longer be caught, or, after the five throws, when a pair of throws separates the
teams. Shoot-out goals decide the winner but do not count in the match score or statistics.

### Live entry checks (`live.ts`)

HMMS enforces only what it can know: team membership, disqualified or suspended players,
court presence for substitutions, and shoot-out order. A shot by a player shown on the bench is
recorded with a warning, because the operator may have missed a rolling substitution.

A correction is checked against the situation at the time of the original event. A substitution
that later entries depend on, or a shoot-out throw that is not the last one, cannot be changed
until the later entries have been corrected.

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

A team that is short may bring a player on without anyone going off, but only while it has fewer
players on court than currently allowed. A player may leave at any time without a replacement,
which is how a team drops to strength after a team official is suspended.

A sanction given in a break takes effect when play resumes, so its timer starts at the next
period. A sanction before the throw-off (period 1, clock never started) does not reduce the team.

**Known gap:** the 4-minute team reduction for a disqualification in the circumstances of IHF
16:9 b-d is not automated. HMMS applies the normal 2-minute reduction, and an operator cannot
extend it. Confirm the current wording of this rule before relying on it in those situations.

Sanctions cannot be edited. To correct one, void it and record it again. Voiding a suspension also
voids the automatic disqualification it caused, and an earlier suspension can only be voided after
the later ones, because suspensions are numbered.

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
| Duration | 60 s of real time, while the match clock is stopped |
| Warning signal | 10 s before the end. VERIFY against IHF 2:10 Clarification 3 |

A faulty request (4th, 3rd in a half, 2nd in the last five minutes, any in overtime) is
refused with the reason.

Granting a time-out stops the match clock at once. While it runs, shots and play events are
refused and the clock cannot be started, but substitutions and sanctions can be recorded. It ends
by itself or when the operator ends it. The clock stays stopped until play restarts. If HMMS
closes during a time-out, the time-out continues in real time and the clock needs no recovery.
Voiding a time-out gives it back to the team.

## Lineups (IHF 4:1, 4:2)

- Up to 16 players on the match sheet, up to 4 team officials (A-D).
- At most 7 starters, at least 5 to start (hard limits); fewer than 7 is a warning.
- At most one starting goalkeeper, who must be a starter; none is a warning.
- Jersey numbers 1-99, unique within the team; at most one captain.
- Substitutions are unlimited (rolling); HMMS never counts them against a limit.

## Statistics (`tally.ts`, `statistics.ts`)

Every number comes from active ledger events. Voided events never count. The definitions are:

| Statistic | Definition |
| --- | --- |
| Shots | Every recorded shot: goal, saved, missed, blocked, post or crossbar. |
| Shooting % | Goals divided by shots. |
| Shots faced | Shots on target against a goalkeeper: saves plus goals conceded. Missed, blocked and post shots do not count. |
| Save % | Saves divided by shots faced. A team's rate uses all goals conceded, including those with no goalkeeper on record. |
| 7 m | 7-metre throws are also included in the shot, goal and save totals, and are listed separately. |
| Team sanctions | Include those of team officials. Player totals do not. |
| Matches | Finalized matches the player took part in: started, was brought on, or is named in an active event. A player on the match sheet with none of these is not counted. |

Shoot-out throws decide the winner and appear in the report, but are not match statistics. A
rate with nothing to measure is shown as a dash, not as 0%.

Playing time is not calculated. It would be wrong whenever substitutions are not being recorded,
so `player_statistics.playing_time_ms` stays empty.

## Module map

| File | Responsibility |
| --- | --- |
| `rules.ts` | `RulesConfig` schema and presets |
| `periods.ts` | Period plan, cumulative time, formatting |
| `clock.ts` | Monotonic clock arithmetic |
| `ledger.ts` | Derive score, court status, sanctions and running reductions from events |
| `tally.ts` | Every player and team count of a match, shared by all screens and reports |
| `statistics.ts` | Score flow, goals by period, shooting breakdown, appearances, percentages |
| `discipline.ts` | Plan the ledger events for a disciplinary decision |
| `timeouts.ts` | Validate team time-out requests |
| `lineup.ts` | Validate match roster and starting lineup |
