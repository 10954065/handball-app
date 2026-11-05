# HMMS - Testing Strategy

| Layer | Tool | Location | What it proves |
| --- | --- | --- | --- |
| Rules engine (unit) | Vitest, node | `tests/unit` | Clock arithmetic, period plans, discipline, time-outs, lineup validation, ledger derivation. |
| Services + database (integration) | Vitest against real SQLite files | `tests/db` | Migrations, constraints, transactions, auth, settings, backup/verify, the live match engine with simulated time and crashes, statistics and reports checked against a hand-counted match and raw SQL counts of the ledger, and Excel files read back with ExcelJS. |
| UI components | Vitest + React Testing Library, jsdom, mocked preload bridge | `tests/ui` | Forms, validation, confirmation of critical actions. |
| End-to-end | Playwright driving the built Electron app | `tests/e2e` | Real application: first-run setup, persistence across restarts, backup, demo mode, live match flows, PDF and Excel files on disk, the archive, and a correction reaching every view. Printing is checked up to the call to the system print dialog, which is stubbed. |

better-sqlite3 13 ships Node-API binaries, so the same native module runs in Node (tests) and
Electron (app). Database tests therefore exercise the real SQLite engine, not a mock.

E2E tests run against an isolated data folder (`HMMS_USER_DATA`) and never touch real data.

## Commands

```bash
npm test                # unit + db + ui
npm run test:coverage   # with V8 coverage (shared domain, services, db)
npm run test:e2e        # builds, then runs Playwright against the Electron app
npm run typecheck       # main/preload/shared and renderer projects
```

## Phase gates

A phase is complete only when: typecheck is clean, all suites pass, the E2E flow for the phase
passes in the built application, persistence across a restart is verified, and CHANGELOG.md is
updated. Coverage target for `src/shared/domain` and `src/main/services`: 80 %+.
