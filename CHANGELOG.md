# Changelog

All notable changes to HMMS are recorded here.

## [0.6.0] - Phase 6: Statistics and reports - 2026-11-05

### Added
- Statistics page: player, goalkeeper and team totals over finalized matches, filtered by
  competition, season and team, with sortable tables, top scorers and Excel export.
- Match statistics on the match page: score flow, goals by period and team comparison.
- A4 match report: result, half-time, both match sheets with sanction times, team officials,
  goalkeepers, time-outs, team statistics, timeline, corrections and signature lines. The
  header, footer and optional sections follow the report settings.
- PDF, Excel and printing from one report. The preview, the PDF and the printout are the same
  page. Reports made before a match is finalized are marked provisional and demonstration data
  is marked, at the top of the report and in the footer of every PDF page.
- Report archive: every saved file is kept in the database. Saving an identical report reuses
  the archived file. A later correction marks older files as outdated, as does finalizing a
  match that a provisional file was made for.
- Every report prints a fingerprint of the event ledger it was made from.
- Match History page with search and filters by competition, team and date.
- Migration `0003_statistics_reports` adds the statistics and archive columns.

### Fixed
- The live screen counted missed shots as shots faced by the goalkeeper, while the player
  profile did not. Both now count saves plus goals conceded.
- The red dot beside Live Match Centre was always on. It now shows only while a match is live.
- The player profile counted matches in progress and matches sat out on the bench. Its totals
  now cover finalized matches the player took part in, the same as the Statistics page.

### Changed
- The live screen, reports, statistics and player profile share one tally of the ledger.
- A finalized match that is corrected now shows as "Final (amended)" in match lists.
- Demonstration files are named `DEMO - ...`, and every Excel sheet carries the notice.

## [0.5.0] - Phase 5: Rules and discipline - 2026-11-05

### Added
- Warnings, 2-minute suspensions, red cards and blue cards for players, by button or keyboard
  (`Y`, `X`, `R`), with yellow card and suspension markers on the player tiles.
- Sanctions for team officials A-D from the team board. An official's suspension or
  disqualification reduces the team on court.
- Running team reductions with independent countdowns in playing time, on the team board and
  the public scoreboard. They stop with the clock and carry over breaks.
- Automatic disqualification on the third suspension, with one team reduction. Voiding the
  suspension also voids the disqualification.
- Rule conflicts, such as a second warning for a player, are shown for acknowledgement and the
  decision is then recorded, with the acknowledgement in the audit log.
- Team time-outs: the clock stops at once, a countdown shows on both screens, limits are
  enforced, and a faulty request is refused with the reason.
- Signals on the operator screen: suspension expiry, time-out warning and time-out end, each
  following the sound settings.
- A team can return to strength after a suspension without anyone going off, and a player can
  leave without a replacement.
- Migration `0002_live_timeouts` adds the monotonic start and process id to `timeouts`.

### Fixed
- A suspension started a team reduction timer even where the rules give none, such as in the
  penalty shoot-out.

### Changed
- The event entry panel is more compact, so the timeline stays visible with a player selected.
- Confirmations and errors in the match centre appear in the centre column. As page toasts they
  could cover the away team's tiles, and stayed there while the pointer was over them.

### Tests
- 151 unit, database and UI tests and 7 end-to-end flows, each repeated five times without a
  failure. One test covers each documented discipline and time-out rule.

### Known gaps
- The 4-minute team reduction of IHF 16:9 b-d is not automated (see HANDBALL_RULES_ENGINE.md).

## [0.4.0] - Phase 4: Live match engine - 2026-11-05

### Added
- Live Match Centre: matches in progress, matches ready to start and fixtures waiting for
  lineups; the match centre with scoreboard, both teams as jersey tiles, event entry and
  timeline.
- Match clock owned by the main process: derived from a monotonic anchor, never counted tick
  by tick, stops exactly at the end of a period, and writes a recovery checkpoint every second.
- Crash recovery: a clock left running by a previous process is detected on the next start.
  Recorded events are kept, and the operator chooses the time to continue from.
- Period flow: halves, breaks with a countdown, overtime and penalty shoot-out as the match
  rules and score require. Ending a period early needs confirmation.
- Goals and shots with outcome, situation and zone; technical faults, turnovers, steals, blocks,
  notes and substitutions. The opposing goalkeeper on court is credited automatically.
- Two-click entry (tile, outcome) and full keyboard operation: Space for the clock, H or A and a
  jersey number to select a player, letters to record, Ctrl+Z to undo, Esc to clear.
- Corrections: void or edit with a required reason. The original stays in the ledger, struck
  through; every correction is audited. Finalized matches can be corrected by administrators
  only, which rewrites the result and marks the match as amended.
- Finalizing a match writes the result from the ledger, and standings pick it up.
- Second-screen public scoreboard, using an external display when one is connected.
- Existing settings now take effect: advanced statistics, assist prompt, court presence
  tracking, confirmation of critical actions, period-end horn, backup on finalize, and scoreboard
  logos and full screen.
- Demo mode includes a sample friendly with both lineups confirmed.
- Closing HMMS while a clock is running asks for confirmation and stops the clock.
- Migration `0001_live_clock` adds the monotonic anchor and boot id to `match_clock`.

### Changed
- The ledger is ordered by period, match time and entry order, so a corrected event keeps its
  place in the match.

### Not yet available
- Warnings, suspensions, disqualifications and team time-outs cannot be entered until phase 5.

### Tests
- 122 unit, database and UI tests and 6 end-to-end flows, including a real kill of the main
  process followed by recovery.

## [0.3.0] - Phase 3: Starting lineups - 2026-11-05

### Added
- Match sheet and starting lineup screen for both teams side by side: visual player cards with
  photograph, large jersey number, name and position; starting seven, substitutes and the
  not-selected squad pool. One click moves a player between pool, substitutes and starters.
- Starting goalkeeper and captain designation, live counters (starters, match sheet size,
  goalkeeper, captain) and live validation with the shared rules engine (max 7 starters,
  min 5, one starting goalkeeper who must start, unique jerseys, max 16 on the sheet, one
  captain).
- "Add whole squad" and "Suggest seven" (primary goalkeeper plus one player per position).
- Team officials A-D on the match sheet, prefilled from the team staff.
- Ineligible players (pending, suspended, inactive registration or archived) are shown but
  cannot be selected.
- Saved lineups are snapshots (name, position, photo, designations); later roster edits never
  change them. Drafts may be incomplete; confirmation requires a valid lineup. Editing a
  confirmed lineup clears the confirmation. When both teams are confirmed the match becomes
  "Lineups ready" and a final confirmation view shows both starting sevens.
- The match sheet locks once the match has started.
- Tests: 8 new database tests and a lineup end-to-end flow (83 unit/db/ui tests, 5 E2E flows).

## [0.2.0] - Phase 2: Administration - 2026-11-05

### Added
- Dashboard with totals, live matches, upcoming fixtures, recent results, standings of the
  active season, top scorers (from the event ledger), recent activity and quick actions.
- Teams: registration with logo, colours, staff, club and region; team profile with visual
  roster cards; captain and primary goalkeeper designation; archive/restore.
- Players: registration with photograph, permanent player ID (P-000001...), position,
  goalkeeper designation, status; search by name, ID or jersey number; filters by team and
  position; free agents; player profile with ledger-derived statistics, discipline and match
  history; transfers and jersey changes that preserve registration history.
- Duplicate jersey numbers are rejected within an active team roster (service check and a
  partial unique index).
- Officials and venues management.
- Competitions with format, category, rules (IHF presets plus adjustable values), points system
  and ordered tie-breakers; seasons; team registration with groups; fixtures list.
- Standings engine (pure, tested): configurable points, head-to-head evaluated among tied teams,
  goal difference, goals scored; finalized matches only.
- Match creation with competition/season, teams, date and time, venue, officials and rules.
  Rules and team names/colours are snapshotted onto the match. Unstarted fixtures can be edited
  or deleted; started matches cannot be deleted.
- Images stored in the database and served through a sandboxed `hmms-media://` protocol with
  file-type verification.
- Demonstration mode seeds clearly labelled sample teams, players, officials, venues, a league
  season and fixtures into the separate demo database only.
- Tests: 75 automated tests (unit, database, UI) and 4 Electron end-to-end flows.

### Fixed
- Correlated sub-queries for team player counts and official match counts.
- Transfers can no longer be dated before the current registration began.

## [0.1.0] - Phase 1: Desktop foundation - 2026-11-05

### Added
- Electron 45 application scaffold with electron-vite, React 19, TypeScript 5.9, Tailwind CSS 4.
- Secure architecture: context isolation, sandboxed preload, no Node.js in the renderer, strict
  CSP, blocked navigation and pop-ups, denied permission requests.
- Typed IPC contract with zod validation, sender verification and role-based permissions.
- SQLite database (better-sqlite3, WAL, synchronous FULL, foreign keys) with Drizzle schema for
  all 26 tables and a bundled, transactional migration runner.
- First-run administrator setup, local sign-in with scrypt password hashing and lockout after
  repeated failures, user management (admin / operator / viewer), password change.
- Application settings (organisation, default rules, theme, live-operation options, sound,
  automatic backup).
- Verified backups (online backup API, integrity check, SHA-256), export to USB/folder,
  automatic interval and shutdown backups with retention, reversible restore with pre-restore
  backup, integrity check, backup history.
- Audit log and daily rotating error log.
- Demonstration mode on a separate database with a permanent banner.
- Design system: dark control-room theme (and light theme), Barlow Condensed display type,
  buttons, fields, dialogs, confirmations, tabs, switches, badges, panels, empty states.
- Application shell with collapsible sidebar and the eleven primary sections; sections from
  later phases are clearly marked as not yet available.
- Handball rules engine (pure, tested): monotonic clock, cumulative period plan with overtime and
  shoot-out, rule presets, ledger-derived match state, disciplinary planning, time-out
  validation, lineup validation.
- Test suites: 37 unit, 15 database integration, 4 UI, 2 Playwright end-to-end (Electron).
