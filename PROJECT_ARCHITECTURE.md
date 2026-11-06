# HMMS - Project Architecture

HMMS is an offline-first Windows desktop application built with Electron. All data lives in a
local SQLite database owned by the trusted main process. The renderer (React UI) has no Node.js
access and talks to the main process only through a typed, validated IPC contract.

## Process model

```
+--------------------------- Electron main process (trusted) ---------------------------+
|  index.ts            lifecycle, single-instance lock, hardening, shutdown backup      |
|  context.ts          AppContext: open DB handle, data mode (production/demo), session |
|  ipc/register.ts     one ipcMain.handle per contract channel:                         |
|                        sender check -> zod validation -> permission check -> handler  |
|  ipc/handlers/*      thin adapters from channels to services                          |
|  services/*          business logic, Electron-free (unit/integration testable)        |
|  db/                 Drizzle schema, bundled SQL migrations, connection (WAL)         |
|  autoBackup.ts       periodic verified backups                                         |
|  restore.ts          verified, reversible restore                                      |
+-------------------------------------------^--------------------------------------------+
                                            | contextBridge: invoke(channel, input), on(event)
+------------------------ preload (sandboxed, contextIsolation) -------------------------+
|  exposes window.hmms = { invoke, on } only. Channel names are pattern-checked.         |
+-------------------------------------------v--------------------------------------------+
+--------------------------- Renderer (React 19, untrusted) -----------------------------+
|  lib/api.ts          typed call<K>(channel, input) -> output, ApiError                 |
|  lib/query.ts        TanStack Query wrappers (cache + invalidation by channel prefix)  |
|  components/ui/*     design system (shadcn-style on Radix primitives)                  |
|  pages/*             feature screens                                                   |
+----------------------------------------------------------------------------------------+
         src/shared/   pure TypeScript used by both sides: domain rules engine, zod
                       schemas, IPC contract, DTOs. No Electron, no Node, no DOM.
```

## Key decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Desktop shell | Electron 45 + electron-vite | Mature Windows support, one codebase, secure defaults. |
| Database | SQLite via better-sqlite3 13 (Node-API prebuilds) | Single local file, transactional, WAL, no server. The same binary loads in Node and Electron, so DB tests run against real SQLite. |
| ORM | Drizzle | Typed schema, generated SQL migrations that we review and bundle. |
| Migrations | Custom runner over drizzle-kit SQL, bundled with `import.meta.glob` | No runtime file lookup in the installed app; each migration in its own transaction; failure stops startup. |
| Validation | Zod schemas in `src/shared` | Same schema validates in main (authoritative) and in forms (UX). |
| IPC | Single contract object | Compile-time completeness: `HandlerMap` must implement every channel. |
| Passwords | Node scrypt (N=2^15, r=8, p=1) | No native dependency, memory-hard, timing-safe compare. |
| Images | Stored as BLOBs in `media` | A backup is one file; nothing lives in the install folder. |
| Reports | Hidden window + `printToPDF` / native print; ExcelJS | Pixel-perfect A4 reports with the same design system, fully offline. |
| Fonts/icons | Bundled (@fontsource, lucide) | No network at runtime. |

## Security posture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- Strict CSP in `index.html` (no remote origins, no eval).
- Navigation and `window.open` blocked; permission requests denied.
- IPC: sender origin check, zod validation of every payload, role permission per channel,
  unexpected errors are logged and returned as a generic message.
- Roles: `admin`, `operator`, `viewer` (see `ROLE_PERMISSIONS`).

## Data locations (Windows)

| Item | Location |
| --- | --- |
| Production database | `%APPDATA%\HMMS\data\hmms.db` (+ `-wal`, `-shm`) |
| Demonstration database | `%APPDATA%\HMMS\data\hmms-demo.db` |
| Backups | `%APPDATA%\HMMS\backups\` (demo: `backups\demo\`) |
| Logs | `%APPDATA%\HMMS\logs\hmms-YYYY-MM-DD.log` (14 days kept) |

## Match engine (phases 4-5)

The event ledger (`match_events`) is the single source of truth. Score, court presence,
running suspensions and statistics are derived by pure functions in `src/shared/domain`
(`deriveMatchState`, `planSanction`, `checkTimeout`, `validateLineup`). The main process owns
the match clock (monotonic `performance.now()` anchor, persisted checkpoints for recovery) and
pushes snapshots to every window, including the optional second-screen scoreboard.

The clock row stores the monotonic start of the current run and the id of the process that
owns it. A running clock with a different process id means the application stopped unexpectedly:
it is reported stopped at its last checkpoint until the operator chooses a time. A 250 ms timer
in the main process stops clocks at the end of a period and writes checkpoints once a second.

Windows display the time by extending the last snapshot with their own monotonic clock and
resynchronise every 5 seconds and on every `live.changed` push. Event times always come from the
main process, never from a window.

Team time-outs run in real time on the same principle: a monotonic start owned by one process,
with wall time as the fallback after a restart. Suspension timers need no clock of their own,
because they are derived from match time. The `suspensions`, `timeouts` and `substitutions`
tables mirror the ledger for reporting and are never the source of truth.

Live services are in `src/main/services/live` and stay Electron-free. Tests inject the monotonic
source and process id through `Ctx`, so time and crashes can be simulated exactly.

## Statistics and reports (phase 6)

`liveTallies` is the only code that counts events. The live screen, the player profile, the
report and the statistics cache all read it, so they cannot use different definitions.

`player_statistics` and `team_statistics` are rebuilt from the ledger inside the transaction that
finalizes or corrects a match. The Statistics page reads them, because totals cross many matches.
Finalized matches with no cache are rebuilt on the next read, which covers older backups.

`matchReport` builds one `MatchReportDTO` from the ledger, and everything else uses it: the match
page, the preview, the PDF and the workbook. The React component `MatchReportDocument` is the
preview, and it is also what is printed: a hidden `BrowserWindow` loads `#/print/report/:id` with
the same secure preferences as any other window, and `reportWindow.ts` waits until the page sets
`data-report-state` before calling `printToPDF` or `print`. Nothing leaves the machine.

Generated files are stored in `match_reports`, so a backup includes them. A file is outdated when
the current ledger's fingerprint differs from the one it was made from.

## Competitions (phase 7)

Standings and brackets are derived, not stored. `seasonStandings` calculates from finalized
matches on every read, and `knockout_ties` stores only the structure: first-round teams and which
fixture belongs to which tie. `resolveBracket` works out every later round from the results, so a
correction reaches the bracket with nothing to keep in step. When a correction contradicts a
fixture that already exists, the tie reports a problem for the competition administrator.

`reportWindow.ts` renders any print route, so the competition report uses the same hidden window
as the match report. Competition reports are made on request and are not archived.

## Deployment and recovery (phase 8)

`electron-builder.yml` builds an NSIS installer that offers an install for the current user, which
needs no administrator rights, or for all users. Data stays per Windows account either way.
Only `out/` and the production dependencies are packaged. The renderer is fully bundled, and the
one native module, better-sqlite3, is a prebuilt Node-API binary that links only to `KERNEL32.dll`,
so a target PC needs no Visual C++ runtime. Electron fuses disable running as Node, `NODE_OPTIONS`
and the Node inspector, and check the archive's integrity at start. Installers are not code-signed,
so SmartScreen warns on first run until a certificate is bought.

Startup runs through `openDataOrRecover` in `startup.ts`:

- A marker file, `hmms.running`, is written at start and removed on a clean close. If it is already
  there, the previous session did not close, so the whole file is integrity-checked before use.
- `openDatabase` refuses data with migrations it does not know, which means a newer version wrote
  it. `DatabaseRefused` means the data is healthy, so a backup is never offered for it.
- Before migrating an existing database, `snapshotBeforeUpdate` copies it with `VACUUM INTO`. If
  the copy fails the update does not go ahead.
- A backup is offered only when the file itself is damaged or missing (`isDamage`). A locked file,
  a full disk or a failed migration leave healthy data, so HMMS explains and quits. Replacing data
  is never the default button.
- `installBackup` copies the backup first, then moves the journals and the damaged file to a
  `damaged-<date>` folder beside the database, and puts them back if a step fails.

During a session, `render-process-gone` reloads the screen, because sign-in and match state are in
the main process. Three reloads in a minute is the limit, then the operator is told. Route errors
show `ScreenError`, and screen errors reach the log through `app.reportError`. An exception in the
main process is logged and leaves the program running: a modal box would block the clock.

`powerSaveBlocker` keeps the display on while any match is live. Sleep can still happen, such as a
closed lid, and `performance.now()` can keep counting across it, so `powerMonitor` stops the
clocks on `suspend`. Not every laptop reports sleep to applications, so a gap of 30 seconds between
ticks does the same, stopping the clocks at the last tick. Demonstration mode cannot open during a
live match, because all of this follows the open database.

The application menu is removed outside development, so Ctrl+R and Ctrl+W do nothing during a
match. `will-navigate` compares the exact renderer file, because every file on the computer has a
`file://` address and dropping one on the window would otherwise replace HMMS with it. The
`ELECTRON_RENDERER_URL` development setting is ignored in an installed copy, since it would load a
page with the preload bridge.

The guides in `docs/` are compiled into the renderer and shown under Help & guides, so they work
offline and always match the installed version.
