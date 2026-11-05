# HMMS - Development Roadmap

Each phase is committed and pushed separately. A phase is marked complete only when its
acceptance criteria pass (see TESTING_STRATEGY.md).

| Phase | Scope | Acceptance criteria | Status |
| --- | --- | --- | --- |
| 1 Desktop foundation | Electron + React + TS, SQLite + Drizzle, migrations, secure preload and typed IPC, shell and navigation, design system, first-run admin setup, users and roles, settings, backup/restore/integrity foundation, demo mode switch, audit log, logging | Windows app starts and stores data locally; restart keeps data | **Complete** |
| 2 Administration | Dashboard, teams, players (photos, transfers), officials, venues, competitions, seasons, match creation, demo sample data | All information can be created, edited, searched and persists after restart | **Complete** |
| 3 Starting lineups | Match roster selection, starting seven, goalkeeper, captain, substitutes, team officials A-D, validation, snapshot, confirmation screen | Both teams can be configured correctly before a match begins | **Complete** |
| 4 Live match engine | Scoreboard, monotonic clock, periods, goals and shots, timeline, player selection, substitutions, persistence, crash recovery, undo/corrections, second screen | A complete match can be recorded with accurate scoring and recoverable data | **Complete** |
| 5 Rules and discipline | Warnings, suspensions with simultaneous timers and expiry sound, third-suspension disqualification, red and blue cards, officials, time-outs | Engine passes automated tests against documented rules | **Complete** |
| 6 Statistics and reports | Player, goalkeeper, team statistics, match sheet, PDF, Excel, printing, archive, history | Statistics and reports agree with the event ledger | **Complete** |
| 7 Competition management | Fixtures, standings, results, groups, knockout rounds, competition reports | Competition records calculated correctly from finalized matches | Planned |
| 8 Deployment | Windows installer, icon, versioning, data directory, crash recovery, error logging, production build, user/admin/operator guides | Installs and runs on a clean Windows PC without Node.js, terminal or internet | Planned |

Note: the pure rules engine (clock, periods, discipline, time-outs, lineup, ledger derivation)
was implemented and tested in phase 1 because the database schema depends on it. Phases 4-5
wire it into the live match services and UI.
