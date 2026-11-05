# HMMS - Product Requirements

## Vision

A complete, offline-first handball match operations and competition management application for
Windows, used by the match secretary / scorekeeper at the official table during live indoor
games, and by associations to run competitions.

## Primary users

| User | Needs |
| --- | --- |
| Match secretary / scorekeeper (operator) | Record goals, sanctions, time-outs and substitutions in one or two clicks without leaving the live screen; see every running suspension; never lose data. |
| Timekeeper | Accurate clock and suspension countdowns, independent of computer clock changes. |
| Competition administrator | Teams, players, officials, competitions, fixtures, standings, reports, backups. |
| Viewer (association, media) | Read-only access to results, statistics and reports. |
| Public (second screen) | Scoreboard with teams, score, clock, period, time-outs. |

## Non-negotiable qualities

- Works with no internet connection, ever. No cloud, no online login, no remote assets.
- No silent data loss: every event is committed transactionally (WAL, synchronous FULL),
  backups are verified, restores are reversible, crashes are recoverable.
- No fake controls: every visible control works. Modules from later phases are clearly marked.
- No sample data in the production database. Demonstration mode uses a separate database
  with a permanent on-screen banner.
- Historical matches are never modified automatically; corrections are explicit and audited.
- Live operation: large targets, high contrast, minimal clicks, keyboard shortcuts, protection
  against accidental critical actions and double submission.

## Functional scope

1. Dashboard - totals, upcoming matches, recent results and activity, standings, top scorers, quick actions.
2. Players - full registration, photo, positions, designations, status, transfers with history, profile with statistics and discipline.
3. Teams - identity, logo, colours, staff, roster with captain/goalkeeper indicators.
4. Officials and venues.
5. Match setup - teams, competition, date, venue, officials, rules, roster confirmation, starting seven, goalkeeper, captain, final confirmation; lineup snapshot.
6. Live Match Centre - scoreboard, clock and periods, goals with player identification, shot outcomes and situations, assists and other statistics, timeline with audited corrections, substitutions, discipline with simultaneous suspension timers, time-outs.
7. Statistics - player, goalkeeper and team statistics derived from the ledger.
8. Reports - match sheet preview, PDF, Excel, A4 printing, report archive.
9. Competitions - league, knockout, groups, groups + knockout, friendly; seasons, fixtures, standings with configurable points and tie-breakers.
10. Match history and retrieval.
11. Settings - application, rules, sounds, display, users and permissions, backup/restore, import/export.
12. Second-screen scoreboard.
13. Windows installer.

Acceptance criteria per phase are listed in DEVELOPMENT_ROADMAP.md.
