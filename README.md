# HMMS - Handball Match Management System

Offline Windows desktop application for handball match operations and competition management:
team and player registration, starting lineups, a live match centre with scoreboard, clock,
goals, discipline, suspensions, time-outs and substitutions, statistics, reports and
competitions. Built for match secretaries and scorekeepers at the official table.

> Status: **Phases 1-4 (desktop foundation, administration, starting lineups, live match engine) complete.** Next: rules and discipline. See [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md).

## Key properties

- **Fully offline.** No internet, cloud account or online login is ever required.
- **Local data.** One SQLite database in `%APPDATA%\HMMS\data\`, never in the install folder.
- **Safe.** Transactional event recording, verified backups, reversible restore, audit log.
- **Secure Electron.** Sandboxed renderer, typed and validated IPC, role-based permissions.

## Development

Requirements: Windows 10/11 x64, Node.js 22+ (developed on Node 24), Git.

```bash
npm install          # installs dependencies (better-sqlite3 uses prebuilt Node-API binaries)
npm run dev          # start the app with hot reload
npm run typecheck
npm test             # unit, database and UI tests
npm run test:e2e     # builds and drives the real Electron app with Playwright
```

If npm reports install scripts that are not allowed, run `npm approve-scripts` for
`electron`, `better-sqlite3` and `esbuild` (npm 11 allow-scripts).

Running from a VS Code terminal: VS Code sets `ELECTRON_RUN_AS_NODE=1`; unset it before
starting Electron manually (`npm run dev` and the E2E tests handle this).

## First run

1. Start HMMS. The first-run screen asks for the organisation name and creates the
   administrator account (password: 8+ characters with letters and numbers).
2. Sign in. Create further accounts in **Settings > Users & access**:
   - **Administrator** - everything, including users, settings and restore.
   - **Operator** - teams, players, matches and live match operation.
   - **Viewer** - read-only.
3. To explore without touching real data, choose **Explore demonstration mode** on the sign-in
   screen. Demo mode uses a separate database and shows a permanent yellow banner.

## Data storage

| Item | Location |
| --- | --- |
| Database | `%APPDATA%\HMMS\data\hmms.db` |
| Backups | `%APPDATA%\HMMS\backups\` |
| Logs | `%APPDATA%\HMMS\logs\` |

## Backup and restore

- **Automatic:** every 30 minutes while data changes, and on shutdown (configurable).
- **Manual:** Settings > Backup & restore > *Back up now*.
- **USB:** *Export to USB / folder* writes a verified copy to any folder or removable drive.
- **Restore:** from the history list or from a `.db` file. HMMS verifies the file, creates a
  pre-restore backup of the current data first, then replaces the database. You can always
  undo a restore by restoring the pre-restore backup.
- **Integrity check:** verifies SQLite integrity and foreign keys.

## Documentation

- [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md)
- [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md)
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)
- [HANDBALL_RULES_ENGINE.md](HANDBALL_RULES_ENGINE.md)
- [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md)
- [TESTING_STRATEGY.md](TESTING_STRATEGY.md)
- [CHANGELOG.md](CHANGELOG.md)
