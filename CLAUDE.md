# Maxun — CLAUDE.md

Complete project reference for AI-assisted development. Keep this file updated as the codebase evolves.

---

## Project Overview

**Maxun** is an open-source, self-hostable no-code web data extraction platform. Users build "robots" by recording browser interactions in a visual UI. Robots are then scheduled or triggered via API to scrape data at scale.

- **License**: AGPLv3
- **Repo**: monorepo with separate frontend, backend, core library, and browser service
- **Stack**: React + Express + PostgreSQL + Playwright + rrweb + Socket.IO

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Frontend (React + Vite)          :5173              │
│  - Recording UI (rrweb replayer)                     │
│  - Dashboard / Robot management                      │
│  - Socket.IO client for live browser stream          │
└─────────────┬───────────────────────────────────────┘
              │ HTTP + WebSocket
┌─────────────▼───────────────────────────────────────┐
│  Backend (Express + TypeScript)   :8080              │
│  - REST API (auth, robots, runs, storage)            │
│  - Socket.IO server (input events → browser)         │
│  - pg-boss workers (async job queue)                 │
│  - BrowserPool (manages RemoteBrowser instances)     │
└──────┬──────────────────────────┬────────────────────┘
       │ Playwright CDP WS         │ SQL / pgboss
┌──────▼──────────┐   ┌───────────▼──────────────────┐
│  Browser Service │   │  PostgreSQL :5432             │
│  (playwright-   │   │  MinIO (S3) :9000             │
│   extra stealth)│   │  Redis      :6379             │
│  :3001 WS       │   └──────────────────────────────┘
│  :3002 health   │
└─────────────────┘
```

### Data flow for a robot run
1. API call → `POST /api/robots/:id/runs`
2. pg-boss enqueues `interpret-recording` job
3. Worker picks up job → spawns `RemoteBrowser` via browser service WebSocket
4. Playwright executes the recorded workflow steps
5. Extracted data stored in `Run.serializableOutput` (PostgreSQL)
6. Screenshots/files stored in MinIO

### Recording data flow
1. User opens `/recording` page → frontend calls `GET /record/start`
2. Backend creates `RemoteBrowser`, returns browser ID
3. Frontend connects Socket.IO to `/${browserId}` namespace
4. `registerInputHandlers` binds socket events → Playwright actions
5. rrweb records DOM mutations in the remote browser → streams events via `emitEventToBackend` → `socket.emit('rrweb-event')` → frontend replayer

---

## Directory Structure

```
maxun-develop/
├── src/                          # Frontend (React)
│   ├── components/
│   │   ├── browser/              # BrowserNavBar, BrowserContent, BrowserWindow, UrlForm
│   │   ├── recorder/             # DOMBrowserRenderer (rrweb replayer)
│   │   ├── robot/                # Robot create/edit/list UI
│   │   ├── run/                  # Run results display
│   │   ├── action/               # Workflow action builders
│   │   ├── integration/          # Google Sheets, Airtable OAuth
│   │   └── ui/                   # Shared UI components
│   ├── context/
│   │   ├── socket.tsx            # Socket.IO client + SocketProvider
│   │   ├── globalInfo.tsx        # Global app state (browserId, recordingUrl, etc.)
│   │   ├── browserActions.tsx    # Recording action state
│   │   ├── browserSteps.tsx      # Recorded steps state
│   │   └── theme-provider.tsx    # Dark/light mode
│   ├── pages/
│   │   ├── RecordingPage.tsx     # Recording session page
│   │   ├── MainPage.tsx          # Dashboard
│   │   ├── Login.tsx / Register.tsx
│   │   └── PageWrapper.tsx       # Route wrapper + SocketProvider
│   └── api/                      # Axios API client modules
│
├── server/src/                   # Backend (Express + TypeScript)
│   ├── routes/
│   │   ├── auth.ts               # Login, register, OAuth, API keys
│   │   ├── record.ts             # Browser session start/stop
│   │   ├── storage.ts            # Robots CRUD, runs, integrations
│   │   ├── workflow.ts           # Workflow/pair management
│   │   ├── proxy.ts              # Proxy config
│   │   └── webhook.ts            # Webhook management
│   ├── browser-management/
│   │   ├── controller.ts         # initializeRemoteBrowserForRecording, etc.
│   │   ├── inputHandlers.ts      # Socket event → Playwright action handlers
│   │   └── classes/
│   │       ├── RemoteBrowser.ts  # Core browser wrapper (rrweb, streaming, events)
│   │       └── BrowserPool.ts    # Singleton pool of active browser sessions
│   ├── socket-connection/
│   │   └── connection.ts         # createSocketConnection, registerInputHandlers
│   ├── models/
│   │   ├── User.ts               # User model (id, email, password, api_key, proxy_*)
│   │   ├── Robot.ts              # Robot model (recording_meta, recording JSONB, schedules)
│   │   └── Run.ts                # Run model (status, output, logs)
│   ├── storage/
│   │   ├── database.ts           # Sequelize + PostgreSQL setup
│   │   ├── minio.ts              # MinIO S3 client
│   │   └── pgboss.ts             # pg-boss job queue client
│   ├── pgboss-worker.ts          # Async job handlers (browser init, run execution)
│   ├── schedule-worker.ts        # Cron-based robot scheduling
│   ├── mcp-worker.ts             # Model Context Protocol integration
│   └── server.ts                 # Express app entry point
│
├── browser/                      # Standalone browser service
│   ├── server.ts                 # Playwright launchServer + health endpoint
│   └── package.json              # playwright@1.57.0, playwright-extra, stealth
│
├── maxun-core/                   # Extraction engine (npm package)
│   └── src/
│       ├── interpret.ts          # Core workflow interpreter (99KB)
│       └── preprocessor.ts      # Workflow preprocessing
│
├── docker-compose.yml            # PostgreSQL, MinIO, backend, frontend, browser service
├── Dockerfile.backend            # Node 20 slim, tsc build, migrations
├── Dockerfile.frontend           # Vite build
├── nginx.conf                    # Reverse proxy config
├── .env                          # Local environment variables (see below)
├── ENVEXAMPLE                    # Template for .env
└── SETUP.md                      # Setup guide
```

---

## Services & Ports

| Service          | Port  | Command / Notes                                              |
|------------------|-------|--------------------------------------------------------------|
| Frontend (Vite)  | 5173  | `npm run client`                                             |
| Backend (Express)| 8080  | `npm run server`                                             |
| Browser Service  | 3001  | WebSocket endpoint for Playwright CDP                        |
| Browser Health   | 3002  | `GET /health` returns wsEndpoint                             |
| PostgreSQL       | 5432  | `brew services start postgresql@15`                          |
| MinIO API        | 9000  | `MINIO_VOLUMES=~/minio/data minio server --address :9000 ...`|
| MinIO Console    | 9001  | Web UI for MinIO bucket management                           |
| Redis            | 6379  | `brew services start redis`                                  |

---

## Key Commands

### Development (local, no Docker)

```bash
# Prerequisites: PostgreSQL, MinIO, Redis must be running

# 1. Start browser service (keep running in a terminal)
cd browser && BROWSER_WS_PORT=3001 BROWSER_HEALTH_PORT=3002 BROWSER_WS_HOST=localhost \
  node_modules/.bin/ts-node server.ts

# 2. Start full app (builds backend TS, then runs both servers)
npm run start

# 3. Dev mode with hot-reload (nodemon for backend, Vite HMR for frontend)
npm run start:dev

# 4. Build backend TypeScript only
npm run build:server

# 5. Database migrations
npm run migrate
npm run migrate:undo

# 6. Run seeds
npm run seed
```

### MinIO (local)
```bash
# Start MinIO (resolve port conflicts first if needed)
lsof -ti:9000 | xargs kill -9 2>/dev/null
MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin \
  MINIO_VOLUMES=~/minio/data minio server --address :9000 --console-address :9001 &
```

### Cleanup / restart
```bash
# Kill app servers
lsof -ti:8080 | xargs kill -9 2>/dev/null
lsof -ti:5173 | xargs kill -9 2>/dev/null

# Check all services
curl http://localhost:8080/          # Backend
curl http://localhost:5173/          # Frontend
curl http://localhost:3002/health    # Browser service
```

### Docker
```bash
docker-compose up -d                 # Start all services
docker-compose down                  # Stop all
docker-compose logs -f backend       # Stream backend logs
```

---

## Environment Variables (`.env`)

```bash
# App
NODE_ENV=development
JWT_SECRET=<secret>
ENCRYPTION_KEY=<32-char-hex>
SESSION_SECRET=<secret>

# Database
DB_NAME=maxun
DB_USER=postgres
DB_PASSWORD=<password>
DB_HOST=localhost
DB_PORT=5432

# MinIO (S3 storage)
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_PASSWORD=           # Optional, only if Redis has auth

# Ports / URLs
BACKEND_PORT=8080
FRONTEND_PORT=5173
BACKEND_URL=http://localhost:8080
PUBLIC_URL=http://localhost:5173
VITE_BACKEND_URL=http://localhost:8080
VITE_PUBLIC_URL=http://localhost:5173

# Browser Service
BROWSER_WS_PORT=3001
BROWSER_HEALTH_PORT=3002
BROWSER_WS_HOST=localhost

# API Key (optional, set in UI)
MAXUN_API_KEY=<your-api-key>

# Optional: Google OAuth
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GOOGLE_REDIRECT_URI=http://localhost:8080/auth/google/callback

# Optional: Airtable OAuth
# AIRTABLE_CLIENT_ID=
# AIRTABLE_REDIRECT_URI=http://localhost:8080/auth/airtable/callback

# Telemetry (PostHog)
MAXUN_TELEMETRY=true
```

---

## Database Models

### User
| Field              | Type    | Notes                         |
|--------------------|---------|-------------------------------|
| id                 | INTEGER | PK, auto-increment            |
| email              | STRING  | unique, validated             |
| password           | STRING  | bcrypt hashed                 |
| api_key            | STRING  | nullable, user-generated      |
| api_key_name       | STRING  | default: "Maxun API Key"      |
| api_key_created_at | DATE    |                               |
| proxy_url          | STRING  | AES-256 encrypted             |
| proxy_username     | STRING  | AES-256 encrypted             |
| proxy_password     | STRING  | AES-256 encrypted             |

### Robot
| Field           | Type   | Notes                                             |
|-----------------|--------|---------------------------------------------------|
| id              | UUID   | PK                                                |
| userId          | INT    | FK → User                                         |
| recording_meta  | JSONB  | name, pairs count, type, url, params, formats     |
| recording       | JSONB  | WhereWhatPair[] (the actual workflow steps)        |
| google_sheet_*  | STRING | Sheets integration                                |
| airtable_*      | STRING | Airtable integration                              |
| schedule        | JSONB  | ScheduleConfig (cron, timezone)                   |
| webhooks        | JSONB  | WebhookConfig[]                                   |

### Run
| Field               | Type   | Notes                              |
|---------------------|--------|------------------------------------|
| id                  | UUID   | PK                                 |
| status              | STRING | pending / running / completed / failed |
| robotId             | UUID   | FK → Robot                         |
| startedAt/finishedAt| STRING |                                    |
| browserId           | STRING | which browser instance ran it      |
| serializableOutput  | JSON   | extracted data (text/list)         |
| binaryOutput        | JSON   | references to MinIO files          |
| log                 | TEXT   | execution log                      |
| runByAPI            | BOOL   | triggered via REST API             |
| runBySDK            | BOOL   | triggered via SDK                  |
| retryCount          | INT    |                                    |

---

## API Reference (Key Endpoints)

```
Auth
  POST /auth/register          Create account
  POST /auth/login             Login → sets HTTP-only JWT cookie
  GET  /auth/logout            Clear cookie
  GET  /auth/me                Current user info
  POST /auth/api-key           Generate API key

Recording
  GET  /record/start           Init browser session → returns browserId
  GET  /record/stop/:id        Stop browser session
  GET  /record/active          Get active browser ID for current user
  GET  /record/url             Get current URL in browser
  GET  /record/tabs            Get open tabs

Robots (authenticated via cookie or x-api-key header)
  GET  /storage/recordings     List all robots
  POST /storage/robot          Create robot from recording
  GET  /storage/robot/:id      Get robot details + workflow
  PUT  /storage/robot/:id      Update robot
  DELETE /storage/robot/:id    Delete robot

Runs
  POST /storage/robot/:id/runs Trigger a run (sync, waits up to 180min)
  GET  /storage/runs/:robotId  Get run history
  GET  /storage/run/:runId     Get single run details

Integrations
  POST /storage/robot/:id/google-sheet   Connect Google Sheet
  POST /storage/robot/:id/airtable       Connect Airtable base
  POST /webhook/add            Add webhook to robot
  POST /proxy/config           Save proxy settings
```

---

## Socket.IO Events

### Client → Server (input events during recording)
| Event             | Payload                 | Action                       |
|-------------------|-------------------------|------------------------------|
| `input:url`       | url: string             | Navigate to URL              |
| `input:refresh`   | —                       | Reload current page          |
| `input:back`      | —                       | Browser back                 |
| `input:forward`   | —                       | Browser forward              |
| `input:keyup`     | { key }                 | Key release                  |
| `dom:click`       | { selector, elementInfo } | Click element              |
| `dom:keypress`    | { selector, key }       | Type into element            |
| `dom:scroll`      | { deltaX, deltaY }      | Scroll page                  |
| `action`          | CustomActionEventData   | Add workflow action          |
| `removeAction`    | { actionId }            | Remove workflow action       |
| `changeTab`       | tabIndex: number        | Switch browser tab           |
| `addTab`          | —                       | Open new tab                 |
| `closeTab`        | { index, isCurrent }    | Close tab                    |

### Server → Client
| Event               | Payload                  | Description                 |
|---------------------|--------------------------|-----------------------------|
| `rrweb-event`       | rrweb event object       | Live DOM stream (type 2 = full snapshot, type 3 = incremental) |
| `urlChanged`        | { url, userId }          | Page navigated to new URL   |
| `domLoadingProgress`| { progress, userId }     | Loading progress 0–100%     |
| `loaded`            | —                        | Browser session ready       |
| `newTab`            | url: string              | New tab opened              |
| `tabHasBeenClosed`  | tabIndex: number         | Tab closed                  |

---

## Key Implementation Details

### rrweb DOM streaming
- Backend injects rrweb via `page.context().addInitScript(rrwebScript)` — persists across navigations
- rrweb calls `window.emitEventToBackend(event)` (set up via `page.exposeFunction`) → backend emits `rrweb-event` socket event
- Frontend `DOMBrowserRenderer` uses rrweb `Replayer` in **live mode** to replay events in an iframe
- On page navigation/refresh: `framenavigated` fires → waits for `domcontentloaded` → re-initializes rrweb recording
- Type 2 (FullSnapshot) event triggers DOM rebuild in the replayer

### Recording session lifecycle
1. `GET /record/start` → pg-boss job → `initializeRemoteBrowserForRecording(userId)`
2. `createSocketConnection(io.of(browserId), userId, callback)` → registers input handlers
3. `RemoteBrowser.initialize(userId)` → connects to browser service WebSocket → creates page → sets up rrweb
4. Frontend `setId(browserId)` → socket.io connects to `/${browserId}`
5. Backend emits `loaded` → frontend sends initial URL via `input:url`

### Auth
- JWT stored as HTTP-only cookie (stateless — logout only clears client cookie)
- API key auth via `x-api-key` header for `/api/*` routes
- Passwords bcrypt-hashed (rounds: 10)
- Proxy credentials AES-256-GCM encrypted with `ENCRYPTION_KEY`

### pg-boss job queue
Uses PostgreSQL as the job store. Key queues:
- `initialize-browser-recording` — start a browser session
- `destroy-browser` — clean up a browser session
- `interpret-recording` — execute a robot run
- `scheduled-run` — cron-triggered robot execution

---

## Changes Made in This Session

### Bug: Refresh not working in recorder

**Files changed:**

1. **`src/components/browser/UrlForm.tsx`**
   - Removed `readOnly` from URL input (users can now type new URLs)
   - Fixed `handleRefresh` prop type: `(socket: Socket) => void` → `() => void`
   - Fixed `onSubmit`: same URL → calls `handleRefresh()`, new URL → navigates
   - Added `lastSubmittedRef` to track last submitted URL
   - Removed unused `useSocketStore` import

2. **`src/components/browser/BrowserNavBar.tsx`**
   - Added `isRefreshing` state with spinning ↺ icon animation (CSS keyframes)
   - `handleRefresh` sets spinner on click, clears on rrweb type-2 event or 6s timeout
   - Spinner stops as soon as the refreshed page DOM snapshot arrives

3. **`src/components/recorder/DOMBrowserRenderer.tsx`**
   - When a new rrweb full snapshot (type 2) arrives after initial load, briefly sets `isRendered = false` to show the loading indicator — gives visual feedback during refresh/navigation

4. **`server/src/browser-management/inputHandlers.ts`**
   - `handleRefresh`: `page.reload()` → `page.goto(currentUrl, { waitUntil: 'domcontentloaded' })`
   - Skips refresh if URL is `about:blank`

5. **`server/src/browser-management/classes/RemoteBrowser.ts`**
   - `framenavigated` handler: `waitForLoadState('networkidle', 10000ms)` → `waitForLoadState('domcontentloaded', 5000ms)`
   - rrweb re-initializes **much sooner** (~1-2s instead of 10s), capturing images loading in real-time

---

## Roadmap

### Short-term (Quality & Stability)
- [ ] **Recording session recovery** — if the backend restarts while a recording page is open, auto-detect disconnect and re-initialize the browser session
- [ ] **Refresh completion event** — emit a dedicated socket event (e.g. `pageRefreshed`) from the backend when `page.goto()` completes, so the frontend can show accurate loading state
- [ ] **Back/Forward button state** — disable ← → buttons when there's no history, like a real browser (requires backend to expose `page.goBack()`/`page.goForward()` support with history state)
- [ ] **Error boundary in recorder** — if rrweb streaming fails, show a "Reconnecting..." state instead of a blank page
- [ ] **Run status polling** — the current `/api/robots/:id/runs` endpoint is synchronous (waits up to 180 min). Add a proper async endpoint with polling/webhook for run completion

### Medium-term (Features)
- [ ] **Multi-user browser pool isolation** — currently each user gets one recording browser; support multiple concurrent recording sessions per user
- [ ] **Robot versioning** — track changes to a robot's workflow over time with a diff view
- [ ] **Conditional steps** — add if/else branching to robot workflows (e.g. "if element exists, click it; otherwise skip")
- [ ] **Variable extraction** — allow robots to capture variables during execution and pass them to subsequent steps
- [ ] **Run retry logic** — configurable automatic retry for failed runs with exponential backoff
- [ ] **Run diffing** — compare data between two robot runs to highlight what changed
- [ ] **Webhook retry queue** — if a webhook call fails, retry with backoff instead of dropping

### Long-term (Platform)
- [ ] **SDK language support** — official Python and Go SDKs (currently only JavaScript/TypeScript)
- [ ] **Distributed browser pool** — run multiple browser service instances for horizontal scaling
- [ ] **Robot marketplace** — share/import community-built robots
- [ ] **Visual workflow editor** — drag-and-drop step editing without needing to re-record
- [ ] **Proxy rotation** — built-in proxy rotation support (currently single proxy per user)
- [ ] **Anti-bot detection scoring** — show users a detection risk score for their robots
- [ ] **Incremental scraping** — only extract data that changed since last run
- [ ] **Data transformation pipeline** — clean/transform extracted data before export (regex, date normalization, etc.)
- [ ] **OAuth 2.0 for API** — replace API key auth with proper OAuth2 scopes for third-party integrations
