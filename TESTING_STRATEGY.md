# HMMS - Testing Strategy

| Layer | Tool | Location | What it proves |
| --- | --- | --- | --- |
| Rules engine (unit) | Vitest, node | `tests/unit` | Clock arithmetic, period plans, discipline, time-outs, lineup validation, ledger derivation. |
| Services + database (integration) | Vitest against real SQLite files | `tests/db` | Migrations, constraints, transactions, auth, settings, backup/verify, the live match engine with simulated time and crashes, statistics and reports checked against a hand-counted match and raw SQL counts of the ledger, Excel files read back with ExcelJS, and competitions played out through the live engine, including corrections reaching standings and brackets. |
| UI components | Vitest + React Testing Library, jsdom, mocked preload bridge | `tests/ui` | Forms, validation, confirmation of critical actions. |
| Installed package | Playwright attached to the installed program | `tests/package` | The real installer in a folder with a space in its name: no administrator rights, a start with only Windows on the path, data across a restart and an update, a copy before a schema change, a live match and reports from inside the package, no screen requesting anything from the network, and an uninstall that keeps the data. |
| End-to-end | Playwright driving the built Electron app | `tests/e2e` | Real application: first-run setup, persistence across restarts, backup, demo mode, live match flows, PDF and Excel files on disk, the archive, and a correction reaching every view. Fixture generation, bracket creation and competition reports. Screen crashes, sleep, recovery of a damaged database and refusal of newer data. Printing is checked up to the call to the system print dialog, which is stubbed. |

better-sqlite3 13 ships Node-API binaries, so the same native module runs in Node (tests) and
Electron (app). Database tests therefore exercise the real SQLite engine, not a mock.

E2E tests run against an isolated data folder (`HMMS_USER_DATA`) and never touch real data.
`test:package` does the same for its data, but it does install HMMS for the current Windows user
while it runs: shortcuts and an uninstall entry appear, and are removed at the end.

The security fuses block Playwright's Electron launcher in an installed copy, which is the point
of them. The package test starts the program with a debugging port and attaches over that.

## Commands

```bash
npm test                # unit + db + ui
npm run test:coverage   # with V8 coverage (shared domain, services, db)
npm run test:e2e        # builds, then runs Playwright against the Electron app
npm run test:package    # builds two installers, then installs, updates and uninstalls
npm run typecheck       # main/preload/shared and renderer projects
```

## Clean-PC check

The one check no automated test here can do. Windows Sandbox is not available on Windows Home, and
the development PC has the toolchain on it. Use a Windows 10 or 11 PC or virtual machine that has
never had Node.js or development tools, with Wi-Fi and network cables disconnected.

1. Copy the installer from a USB drive and run it. Note what SmartScreen and any antivirus do.
2. Open HMMS from the desktop icon and complete first-run setup.
3. Confirm the desktop and taskbar icons are the HMMS ball.
4. Enter a team and a player, close HMMS, open it again, and confirm they are there.
5. In demonstration mode, run a short match with goals and a suspension, and confirm the sounds.
6. Open the public scoreboard on a second screen or projector, if there is one.
7. Finish the match, save the report as PDF and Excel, open both, and print one to a real printer.
8. Export a backup to USB, then restore it.
9. Hold the power button during a running match, start again, and recover the clock.
10. Close the laptop lid during a running match, wake it, and confirm the clock stopped.
11. Uninstall, and confirm `%APPDATA%\HMMS` is still there.

## Phase gates

A phase is complete only when: typecheck is clean, all suites pass, the E2E flow for the phase
passes in the built application, persistence across a restart is verified, and CHANGELOG.md is
updated. Coverage target for `src/shared/domain` and `src/main/services`: 80 %+.
