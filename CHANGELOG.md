# Changelog

All notable changes to HMMS are recorded here.

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
