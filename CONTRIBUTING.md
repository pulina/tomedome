# Contributing to TomeDome

This document explains how the codebase is structured, how it is bundled, and
how to add things without fighting the architecture. It is meant for people
who will be changing code. For a user-facing overview, see
[README.md](README.md) (including **Roadmap**). Deeper RAG notes live under
`docs/` (e.g. [multi-level retrieval](docs/rag-multi-level-retrieval.md),
[synthetic book evaluation](docs/synthetic-book-evaluation.md)).

The canonical location for this file is the repo root — GitHub links it
automatically from the PR and issue creation UIs.

**RAG design.** [RAPTOR-inspired multi-level retrieval](docs/rag-multi-level-retrieval.md)
explains why raw chunk search misses indirectly described concepts, and how
TomeDome indexes chapter/book abstracts next to chunks (`abstract_embeddings`,
parallel search in `buildRagContext`, chapter-level dedup).

**Evaluating changes without training-data leakage.** Use an invented **synthetic
book** and a golden Q/A set so answers cannot come from model memory alone — see
[synthetic book evaluation](docs/synthetic-book-evaluation.md) (content
checklist, golden set, LLM-as-judge / benchmark framing).

**LLM capability boundary.** The architecture assumes the model has **no**
read–write tools (no file edits, shell, or network actions driven by book or chat
content without explicit user steps). That is why there is no guard-rail LLM on
ingestion: keep new features consistent with that model—if you ever add
agentic tools, revisit trust boundaries explicitly.

---

## 1. High-level architecture

TomeDome is an Electron desktop app with three cooperating processes:

```
┌───────────────────────────────────────────────────────────────┐
│                       Electron app                             │
│                                                               │
│  ┌──────────────────┐        ┌──────────────────────────────┐ │
│  │  Renderer        │◀──────▶│  Main process (Node.js)      │ │
│  │  (React + Vite)  │  HTTP  │  ┌──────────────────────┐    │ │
│  │                  │───────▶│  │  Fastify backend     │    │ │
│  │                  │        │  └──────────────────────┘    │ │
│  │                  │        │  ┌──────────────────────┐    │ │
│  │                  │◀──IPC──│  │  Electron APIs       │    │ │
│  └────────┬─────────┘        │  └──────────────────────┘    │ │
│           │                  │  ┌──────────────────────┐    │ │
│           │                  │  │  SQLite (better-     │    │ │
│           │                  │  │  sqlite3), safeStorage│    │ │
│           │                  │  └──────────────────────┘    │ │
│           ▼                  └──────────────────────────────┘ │
│     Preload script (contextBridge — minimal IPC surface)      │
└───────────────────────────────────────────────────────────────┘
```

**Three processes, three build targets, three tsconfigs.**

| Process  | Runtime   | TS config            | Entry file              |
|----------|-----------|----------------------|-------------------------|
| main     | Node.js   | `tsconfig.node.json` | `src/main/index.ts`     |
| preload  | Node.js   | `tsconfig.node.json` | `src/preload/index.ts`  |
| renderer | Chromium  | `tsconfig.web.json`  | `src/renderer/src/main.tsx` |

### Why HTTP and not IPC for app logic?

The main process runs Fastify on a dynamically chosen localhost port. The
renderer fetches `http://127.0.0.1:{port}/api/...`. Only one IPC call exists:
`getBackendPort()`, exposed via the preload bridge at boot.

This buys us:

- Route handlers that look like any other Node HTTP server — easy to test in
  isolation with `supertest` or curl.
- Structured logging of every request via Fastify's built-in pino logger.
- A clear seam between UI and logic: the renderer could be swapped for a web
  frontend or a different shell without touching the backend.

IPC is reserved for genuinely Electron-only concerns (window controls, native
dialogs, access to `safeStorage` from the main process).

---

## 2. Directory layout

*The tree below is schematic — see `src/main/` for the full route and service list.*

```
TomeDome/
├── src/
│   ├── main/                       # Electron main process
│   │   ├── index.ts                # App entry — bootstrap, window, lifecycle
│   │   ├── server.ts               # Fastify instance assembly
│   │   ├── routes/                 # HTTP handlers
│   │   │   ├── health.ts
│   │   │   └── config.ts
│   │   ├── services/               # Domain logic (pure-ish, no HTTP knowledge)
│   │   │   ├── database.ts         # SQLite init + schema migration
│   │   │   ├── config-service.ts   # Config CRUD + encryption
│   │   │   └── llm-test.ts         # Provider connection tests
│   │   └── lib/                    # Cross-cutting utilities
│   │       ├── logger.ts           # pino instance (file + pretty in dev)
│   │       ├── config-keys.ts      # SQLite `config` row key constants
│   │       ├── config-migrations.ts # config KV version / key renames
│   │       ├── api-errors.ts       # JSON error body `{ type, message }`
│   │       └── safe-storage.ts     # safeStorage wrapper w/ fallback
│   │
│   ├── preload/
│   │   ├── index.ts                # contextBridge — exposes window.electronAPI
│   │   └── electron-api.d.ts
│   │
│   ├── renderer/
│   │   ├── index.html              # Vite HTML entry (with CSP)
│   │   └── src/
│   │       ├── main.tsx            # createRoot(App)
│   │       ├── App.tsx             # RouterProvider
│   │       ├── router.tsx          # HashRouter definitions
│   │       ├── global.d.ts         # Module decls (*.png, *.module.css, …)
│   │       ├── api/
│   │       │   ├── client.ts       # fetch wrapper — resolves backend URL
│   │       │   └── config-api.ts   # Typed wrappers for /api/config/llm/*
│   │       ├── hooks/
│   │       │   └── useLlmStatus.ts
│   │       ├── components/
│   │       │   ├── LlmGate.tsx     # Redirects to /settings until configured
│   │       │   ├── ThemeProvider.tsx
│   │       │   ├── layout/         # AppShell, Sidebar, RightPanel, TopBar
│   │       │   └── settings/       # Settings page + form sub-components
│   │       ├── pages/              # One file per route (mostly placeholders)
│   │       ├── themes/             # Skinnable theme system (see §5)
│   │       ├── styles/             # Non-themed CSS (reset, animations)
│   │       └── assets/             # Images (bg, logo) bundled by Vite
│   │
│   └── shared/
│       └── types.ts                # Types used by BOTH main and renderer
│
├── project_docs/
│   ├── README.md                   # Full product spec
│   └── styling/                    # Original mockups, style guide, source images
│
├── licenses/
│   └── fonts/                      # Redistributed OFL texts (Cinzel, Inter, JB Mono)
│
├── electron.vite.config.ts         # 3-bundle build pipeline
├── tsconfig.json                   # Base TS config
├── tsconfig.node.json              # Main + preload
├── tsconfig.web.json               # Renderer
├── package.json
├── LICENSE
├── README.md                       # User-facing
└── CONTRIBUTING.md                 # This file
```

### Module-boundary rules

- **`src/shared/`** — only pure TypeScript types and constants. No imports
  from `main/` or `renderer/`. Safe to import from both sides.
- **`src/main/`** — may import from `@shared/*`. Never import from
  `renderer/`.
- **`src/renderer/`** — may import from `@shared/*`. Never import from
  `main/` or `preload/` (the renderer has no direct access to Node APIs).

Path aliases are set in `tsconfig.node.json`, `tsconfig.web.json`, and
`electron.vite.config.ts`:

| Alias        | Resolves to           | Available in  |
|--------------|-----------------------|---------------|
| `@shared/*`  | `src/shared/*`        | main, renderer |
| `@/*`        | `src/renderer/src/*`  | renderer only  |

---

## 3. Build pipeline

### Tooling

- **[electron-vite](https://electron-vite.org/)** orchestrates three Vite
  builds in one config: main (SSR bundle), preload (SSR bundle), renderer
  (standard web build).
- **Vite 5** transforms the renderer (React, CSS Modules, image/font assets).
- **TypeScript 5.7** type-checks all three targets via separate `tsc -p`
  invocations (no transpilation — Vite/esbuild handles that).

### What each command does

| Command              | What happens                                               |
|----------------------|------------------------------------------------------------|
| `npm run dev`        | `electron-vite dev` — starts Vite dev server (HMR for renderer), compiles main/preload, launches Electron pointing at `ELECTRON_RENDERER_URL=http://localhost:5173`. |
| `npm run build`      | Builds all three bundles to `out/{main,preload,renderer}/`. Main references preload via `__dirname/../preload/index.js`, renderer loads from `out/renderer/index.html`. |
| `npm run start`      | `electron-vite preview` — runs the production build. |
| `npm run typecheck`  | Runs `tsc --noEmit` against `tsconfig.node.json` then `tsconfig.web.json`. No emitted files. |
| `npm run format`     | Prettier across `src/**/*.{ts,tsx,css,json}`. |
| `npm run lint`       | ESLint on `src/**/*.{ts,tsx}`. |
| `postinstall`        | `electron-rebuild -f -w better-sqlite3` — rebuilds the native SQLite addon against Electron's Node ABI. Runs automatically after `npm install`. |

### better-sqlite3 (native module)

The app depends on **better-sqlite3**, which ships as a native addon and must match **Electron’s Node ABI** (the version pinned under `devDependencies.electron` in `package.json`, not your system Node).

- After `npm install`, `postinstall` runs `electron-rebuild -f -w better-sqlite3` so the binary matches Electron locally.
- If you upgrade **Electron**, change **Node** for development, or check out the repo on a different **OS/CPU** (e.g. Apple Silicon vs Intel), run `npm run postinstall` again if SQLite fails to load (`was compiled against a different Node.js version` or similar).
- Release builds (`npm run dist`) bundle the addon unpacked from `asar`; use the same platform constraints [electron-builder](https://www.electron.build/) documents for your target OS.

### Output layout after `npm run build`

```
out/
├── main/index.js          # CommonJS — run by Electron main process
├── preload/index.js       # CommonJS — loaded via webPreferences.preload
└── renderer/
    ├── index.html
    └── assets/
        ├── index-*.js      # React bundle
        ├── index-*.css     # All non-themed + component CSS Modules
        ├── techno-gothic-*.css   # Default theme (lazy-loaded)
        ├── bg-*.png        # Hashed image assets
        ├── logo-*.png
        └── *-latin-*.woff2 # Hashed font files (Fontsource)
```

Images, fonts, and CSS files are content-hashed so cache-busting is automatic.

### Native modules (`better-sqlite3`)

`better-sqlite3` is a native Node addon. Electron ships a custom Node build
with a different ABI than the system Node, so the addon must be recompiled
against Electron's headers. This is handled by `@electron/rebuild`, invoked
from the `postinstall` script. When upgrading Electron versions, rerun
`npm install` (or explicitly `npx electron-rebuild -f -w better-sqlite3`).

The addon is externalized in the main-process Vite bundle (via
`externalizeDepsPlugin`), so it is `require()`-ed at runtime rather than
bundled — this is the only way native modules work under Electron.

---

## 4. Data flow

### Startup sequence

1. Electron fires `app.whenReady()`.
2. `bootstrap()` in `src/main/index.ts` runs:
   - `getDb()` opens `{userData}/tomedome.db` and creates the `config` table
     if needed.
   - `startServer()` boots Fastify on port 0 (OS-assigned). The actual port
     is captured from `server.address()`.
   - `ipcMain.handle('get-backend-port')` is registered.
   - `createWindow()` opens a `BrowserWindow` pointing at either the Vite
     dev server URL or the built `index.html`.
3. The renderer mounts, the preload has already exposed
   `window.electronAPI.getBackendPort()`.
4. `src/renderer/src/api/client.ts` calls `getBackendPort()` lazily on the
   first HTTP request and memoizes the resulting base URL.

### Typical request path

```
React component
    └─▶ configApi.saveLlmConfig({...})            (api/config-api.ts)
            └─▶ api.put('/api/config/llm', …)     (api/client.ts — fetch)
                    └─▶ PUT http://127.0.0.1:{port}/api/config/llm
                            └─▶ Fastify route     (main/routes/config.ts)
                                    └─▶ saveLlmConfig(...)        (services/config-service.ts)
                                            └─▶ encryptValue()    (lib/safe-storage.ts)
                                                    └─▶ SQLite INSERT/UPDATE
```

Every layer has a single concern. The route validates input; the service
owns the business logic; the lib wraps the platform API; the DB module owns
connection lifetime.

### Secrets and configuration

- LLM API keys live in the SQLite `config` table, encrypted via Electron
  `safeStorage` (OS keychain: macOS Keychain, Windows DPAPI, Linux Secret
  Service).
- If `safeStorage.isEncryptionAvailable()` is false (headless Linux without
  a keyring), values fall back to base64 with a `PLAIN:` prefix and a warning
  is logged. Never useful for real secrets but keeps the app functional in
  CI or VM environments.
- Non-secret config (provider, model, Ollama URL) is stored plaintext in the
  same table.
- API keys are **never** returned to the renderer. The `GET /api/config/llm`
  endpoint returns `apiKeySet: boolean` instead of the key itself. The test
  endpoint reads the key server-side.

### User data directory

Electron's `app.getPath('userData')` gives us a per-platform writable dir:

- macOS: `~/Library/Application Support/TomeDome/`
- Windows: `%APPDATA%\TomeDome\`
- Linux: `~/.config/TomeDome/`

Contents: `tomedome.db` (SQLite), `logs/tomedome.log` (pino). This directory
may later also hold embeddings (Qdrant data dir) and any ingested abstracts /
knowledge graphs.

---

## 5. Theme architecture (skinnable UI)

The techno-gothic look is a **skin**, not a hardcoded style. Any future theme
(clean minimal, steampunk, high-contrast, etc.) can replace it by swapping
one CSS file plus an optional decor component.

### Rules for component CSS

1. **Never** reference a literal color or font family in component CSS
   Modules. Always `var(--token)`.
2. Structural properties (layout, dimensions, spacing) stay in the component.
   They are not themed.
3. Theme-specific decoration (background images, gradients, overlays,
   corner ornaments) lives in a *decor* React component rendered by
   `ThemeProvider` — never in `AppShell`.

### The theme contract

[src/renderer/src/themes/theme-contract.ts](src/renderer/src/themes/theme-contract.ts)
lists every CSS custom property a theme must define. Categories:

- Backgrounds, surfaces, overlays
- Text (primary / secondary / muted)
- Accent + highlight + semantic (success, error)
- Borders, border radii
- Typography (heading / body / mono fonts + letter-spacing)
- Effects (shadows, glows)

### Theme registry

[src/renderer/src/themes/index.ts](src/renderer/src/themes/index.ts):

```ts
export const THEMES: Record<string, ThemeDefinition> = {
  'techno-gothic': {
    id: 'techno-gothic',
    displayName: 'Techno-Gothic',
    Decor: TechnoGothicDecor,
    cssLoader: () => import('./techno-gothic.css'),
  },
};
```

### Adding a new theme

1. Create `src/renderer/src/themes/<id>.css` defining every variable from
   the contract, scoped under `:root[data-theme='<id>']`.
2. Create `src/renderer/src/themes/<id>-decor.tsx` (optional) that renders
   the theme's background layers. Return `null` for a minimal theme.
3. Register in `themes/index.ts`.
4. Done — no changes to any layout or page component are needed.

`ThemeProvider.tsx` sets `document.documentElement.dataset.theme = themeId`
so all CSS variable scopes resolve correctly, then dynamically imports the
theme CSS to keep the initial bundle small.

---

## 6. Adding features — recipes

### New HTTP route

1. Add a handler file under `src/main/routes/<feature>.ts` exporting an
   `async function register<Feature>Routes(fastify: FastifyInstance)`.
2. Put the domain logic in `src/main/services/<feature>-service.ts`. Keep
   the route thin — validation + delegation only.
3. Register the plugin in `src/main/server.ts`.
4. If shared with the renderer, add request/response types to
   `src/shared/types.ts`.
5. Add a typed wrapper in `src/renderer/src/api/<feature>-api.ts`.

### New page / route

1. Create `src/renderer/src/pages/<Name>Page.tsx`.
2. Add a `<NavLink to="/...">` entry to `Sidebar.tsx`'s `NAV_ITEMS`.
3. Add the route to `src/renderer/src/router.tsx` under the `AppShell`
   children.
4. Optionally add a title/meta entry to `TopBar.tsx`'s `TITLES` map.

### New SQLite table

1. Add the `CREATE TABLE IF NOT EXISTS ...` statement to `getDb()` in
   `src/main/services/database.ts`. The schema bootstrap is idempotent on
   every startup.
2. For non-trivial migrations (later): introduce a `schema_version` table
   and run migrations conditionally. We do not use a migration framework
   yet — the app has no production users and the schema is fluid.

### New theme token

If a component needs a token that doesn't exist yet:

1. Add the token name to `theme-contract.ts`.
2. Define a value for it in every theme CSS file under `:root[data-theme='…']`.
3. Reference it via `var(--token-name)` in the component.

Do not add new themes piecemeal — if the contract changes, every theme must
be updated at the same time.

---

## 7. Logging

- **Main process** — `getLogger()` in `src/main/lib/logger.ts` returns a
  singleton pino instance. Writes to `{userData}/logs/tomedome.log`; in dev
  also pretty-prints to stdout via `pino-pretty`.
- **Fastify** — uses its own built-in pino logger (not shared with the main
  logger, to keep the type boundary clean). Every HTTP request is logged at
  `info` with method, path, status, and latency.
- **Renderer** — `console.*` only for now. Client-side errors may later be
  surfaced in the Stats & Logs page.

Log at the boundaries: incoming HTTP, outgoing API calls, background jobs,
and any caught exception. Don't log inside hot loops or pure functions.

---

## 8. Testing

Vitest is installed but not wired into CI. When adding tests:

- **Services** (`src/main/services/`) should be the easiest to test — they
  have no HTTP or Electron dependencies.
- **Routes** can be tested by giving Fastify its own `inject` call —
  no need to actually bind a port.
- **React components** — Vitest + `@testing-library/react` is the intended
  setup. No tests exist yet.

Add a `test` npm script when the first real test lands.

---

## 9. Coding conventions

- **TypeScript strict mode is on**, plus `noUncheckedIndexedAccess` — array
  and record access returns `T | undefined` and must be narrowed.
- **Prettier** formats everything. Run `npm run format` before committing.
- **Import order**: third-party → `@shared/*` → `@/*` → relative. Not
  enforced by a linter yet; match the style in existing files.
- **CSS Modules** for all component styles. Filenames: `Component.module.css`
  next to `Component.tsx`. Global CSS only for the reset, animations, and
  theme files.
- **No literal colors or font families** outside `themes/` — see §5.
- **No backwards-compatibility shims** while we are pre-1.0. Rename, delete,
  refactor freely.
- **Do not add docstrings/comments to code that hasn't changed.** Comments
  go on non-obvious logic only.

---

## 10. Dependencies

- **Hot path** (shipped to users): `electron`, `fastify`, `@fastify/cors`,
  `better-sqlite3`, `pino`, `pino-pretty`, `react`, `react-dom`,
  `react-router-dom`, `@fontsource/*`.
- **Dev-only**: `electron-vite`, `vite`, `@vitejs/plugin-react`,
  `typescript`, types, `@electron/rebuild`, `prettier`.

All production dependencies are MIT/Apache/BSD/ISC/OFL. No GPL family. The
only CC-BY-4.0 dep (`caniuse-lite`) is transitive and dev-only.

Before adding a new dependency:

1. Does `node:` / the standard library or an existing dep cover it? Prefer
   that.
2. Is the license permissive (MIT / Apache-2.0 / BSD / ISC / OFL)?
3. Is the package actively maintained (recent releases, issues being
   triaged)?
4. How much weight does it add to the renderer bundle? Check with
   `npm run build` and compare `index-*.js` size.

---

## 11. Releases and packaging

**electron-builder** is configured in `package.json` under the top-level
`build` key (`appId`, `asarUnpack` for `better-sqlite3`, icons, per-OS targets).

- **`npm run build`** — produces `out/{main,preload,renderer}/` (same as dev
  workflow without HMR).
- **`npm run start`** — `electron-vite preview`; smoke-tests that bundle locally.
- **`npm run dist`** — runs `electron-vite build` then **electron-builder**;
  installers and unpacked app output land under **`release/`** (see
  `directories.output` in `package.json`).

Current targets (see `package.json`): **macOS** (default archive — typically
`.dmg`), **Windows** NSIS x64, **Linux** `.deb` and `.rpm`. Adjust targets and
signing/notarization there when you ship publicly.

---

## 12. Questions? Surprises?

If something in the architecture blocks you from building what you need,
change the architecture — don't work around it. The code is young and no
decision here is load-bearing beyond the current minimal scope. Open an
issue or discuss in a PR before large refactors.
