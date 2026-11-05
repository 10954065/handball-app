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
