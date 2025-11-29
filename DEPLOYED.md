## Maxun Deployment Cheat Sheet (Fly.io + Docker + CORS)

### Overview

- **Apps**:
  - Backend: `maxun-backend` (Node/Express on Fly Machines).
  - Frontend: `maxun-frontend` (Vite/React on Fly Machines).
- **Key configs**:
  - Backend: `fly.backend.production.toml`, `Dockerfile.backend`, `server/src/server.ts`.
  - Frontend: `fly.frontend.production.toml`, `Dockerfile.frontend`, `vite.config.js`, `src/apiConfig.js`.

---

## 1. Backend (Fly.io)

### 1.1. Fly config

Backend config:

```12:25:maxun/fly.backend.production.toml
[build]
  dockerfile = 'Dockerfile.backend'

[deploy]
  strategy = 'immediate'

[env]
  BACKEND_PORT = '8080'
  BACKEND_URL = 'https://maxun-backend.fly.dev'
  MAXUN_TELEMETRY = 'true'
  NODE_ENV = 'production'
  PUBLIC_URL = 'https://maxun-frontend.fly.dev'
  VITE_BACKEND_URL = 'https://maxun-backend.fly.dev'
  VITE_PUBLIC_URL = 'https://maxun-frontend.fly.dev'
```

- `PUBLIC_URL` must be the **frontend origin**.
- `BACKEND_PORT` must match what the app listens on.

### 1.2. Dockerfile

Backend image:

```49:53:maxun/Dockerfile.backend
# Expose backend port
EXPOSE ${BACKEND_PORT:-8080}

# Run migrations & start backend using start script
CMD ["npm", "run", "server"]
```

Server listens on `SERVER_PORT`, which is bound to `BACKEND_PORT`:

```1:1:maxun/server/src/constants/config.ts
export const SERVER_PORT = process.env.BACKEND_PORT ? Number(process.env.BACKEND_PORT) : 8080
```

### 1.3. CORS configuration

Global CORS + preflight handler:

```130:137:maxun/server/src/server.ts
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.PUBLIC_URL || 'http://localhost:5173');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
```

With `PUBLIC_URL='https://maxun-frontend.fly.dev'`, this fully supports credentialed cross-site requests from the Fly frontend.

### 1.4. Allocate IPs (critical)

By default, your Machines app may have **no public IP**, which means `maxun-backend.fly.dev` won’t resolve.

Attach IPs:

```bash
fly ips allocate-v6 -a maxun-backend        # optional but recommended
fly ips allocate-v4 -a maxun-backend --shared
fly ips list -a maxun-backend
```

Verify DNS from your machine:

```bash
nslookup maxun-backend.fly.dev
```

You should see an IP (e.g. `66.241.124.113`) before expecting the browser or curl to work.

### 1.5. Deploy backend

```bash
cd /Users/mk/dev/lexai/maxun
fly deploy -c fly.backend.production.toml --app maxun-backend
```

Check health:

```bash
fly status -a maxun-backend
fly logs -a maxun-backend --region fra --no-tail
```

---

## 2. Frontend (Fly.io)

### 2.1. Vite config and API URL

Frontend resolves backend URL via `apiConfig.js`:

```1:1:maxun/src/apiConfig.js
export const apiUrl = import.meta.env.VITE_BACKEND_URL ? import.meta.env.VITE_BACKEND_URL : 'http://localhost:8080'
```

`vite.config.js` wires env → `import.meta.env`:

```6:21:maxun/vite.config.js
export default defineConfig(() => {
  const publicUrl = process.env.VITE_PUBLIC_URL || "http://localhost:5173";
  const frontendPort = process.env.FRONTEND_PORT || "5173";
  const port = parseInt(frontendPort) || 5173;

  return {
    define: {
      "import.meta.env.VITE_BACKEND_URL": JSON.stringify(
        process.env.VITE_BACKEND_URL
      ),
      "import.meta.env.VITE_PUBLIC_URL": JSON.stringify(publicUrl),
    },
    server: {
      host: "0.0.0.0",
      port: port,
      allowedHosts: [new URL(publicUrl).hostname, ".fly.dev"],
      strictPort: true,
    },
    // ...
  };
});
```

On Fly, `VITE_BACKEND_URL` must be `https://maxun-backend.fly.dev` so the browser doesn’t call `http://localhost:8080`.

### 2.2. Frontend Dockerfile

```1:25:maxun/Dockerfile.frontend
FROM --platform=$BUILDPLATFORM node:18-alpine

WORKDIR /app

# Build-time configuration for Vite
ARG VITE_BACKEND_URL
ARG VITE_PUBLIC_URL
ARG FRONTEND_PORT=5173

ENV VITE_BACKEND_URL=${VITE_BACKEND_URL} \
    VITE_PUBLIC_URL=${VITE_PUBLIC_URL} \
    FRONTEND_PORT=${FRONTEND_PORT}

COPY package*.json ./
RUN npm install --legacy-peer-deps && npm install -g serve

COPY src ./src
COPY public ./public 
COPY index.html ./
COPY vite.config.js ./
COPY tsconfig.json ./

RUN npm run build

EXPOSE ${FRONTEND_PORT}
CMD sh -c "serve -s build -l ${FRONTEND_PORT}"
```

### 2.3. Fly config

```12:23:maxun/fly.frontend.production.toml
[build]
  dockerfile = 'Dockerfile.frontend'
  [build.args]
    VITE_BACKEND_URL = 'https://maxun-backend.fly.dev'
    VITE_PUBLIC_URL = 'https://maxun-frontend.fly.dev'
    FRONTEND_PORT = '5173'

[env]
  FRONTEND_PORT = '5173'
  NODE_ENV = 'production'
  PUBLIC_URL = 'https://maxun-frontend.fly.dev'
  VITE_BACKEND_URL = 'https://maxun-backend.fly.dev'
  VITE_PUBLIC_URL = 'https://maxun-frontend.fly.dev'
```

Service ports:

```25:37:maxun/fly.frontend.production.toml
[[services]]
  protocol = 'tcp'
  internal_port = 5173

  [[services.ports]]
    start_port = 8080
    end_port = 8080
    handlers = ['http']

  [[services.ports]]
    start_port = 443
    end_port = 443
    handlers = ['http', 'tls']
```

Clients will use:
- `https://maxun-frontend.fly.dev/` → routed to internal port 5173.
- Frontend calls `https://maxun-backend.fly.dev/...` via `apiUrl`.

### 2.4. Deploy frontend

```bash
cd /Users/mk/dev/lexai/maxun
fly deploy -c fly.frontend.production.toml --app maxun-frontend
```

---

## 3. End‑to‑end CORS behavior (Fly)

With the above:

- **Origin**: `https://maxun-frontend.fly.dev`
- **Backend**: `https://maxun-backend.fly.dev`
- Backend CORS answers:

  - `OPTIONS /auth/login` and `OPTIONS /auth/register`:
    - `Access-Control-Allow-Origin: https://maxun-frontend.fly.dev`
    - `Access-Control-Allow-Methods: GET,PUT,POST,DELETE,OPTIONS`
    - `Access-Control-Allow-Headers: Content-Type, Authorization`
    - `Access-Control-Allow-Credentials: true`
    - Status `200`.

- Browser then sends `POST` with `withCredentials: true` (as React app does), and cookies are set by backend.

If you see **“CORS request did not succeed, status 0”** on Fly:
- First check DNS/HTTP:

```bash
nslookup maxun-backend.fly.dev
curl -v 'https://maxun-backend.fly.dev/auth/login'
```

- If DNS/HTTP fail → it’s **network/IP/DNS**, not missing headers.
- If HTTP works but browser complains about missing `Access-Control-Allow-Origin` → check `PUBLIC_URL` on backend.

---

## 4. Docker Compose (local / self‑hosting)

Local self‑hosting uses `docker-compose.yml` and `docs/self-hosting-docker.md`.

Key points:

- `.env` example:

```20:41:maxun/docs/self-hosting-docker.md
NODE_ENV=production
JWT_SECRET=...
DB_NAME=maxun
DB_USER=postgres
DB_PASSWORD=...
DB_HOST=postgres
DB_PORT=5432
ENCRYPTION_KEY=...
SESSION_SECRET=...
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001
MINIO_ACCESS_KEY=minio
MINIO_SECRET_KEY=...
REDIS_HOST=maxun-redis
REDIS_PORT=6379
BACKEND_PORT=8080
FRONTEND_PORT=5173
BACKEND_URL=https://maxun.my.domain
PUBLIC_URL=https://maxun.my.domain
VITE_BACKEND_URL=https://maxun.my.domain
VITE_PUBLIC_URL=https://maxun.my.domain
```

- Compose services (simplified):

```90:123:maxun/docs/self-hosting-docker.md
backend:
  image: getmaxun/maxun-backend:latest
  ports:
    - "127.0.0.1:${BACKEND_PORT:-8080}:${BACKEND_PORT:-8080}"
  env_file: .env
  environment:
    BACKEND_URL: ${BACKEND_URL}
  # ...

frontend:
  image: getmaxun/maxun-frontend:latest
  ports:
    - "127.0.0.1:${FRONTEND_PORT:-5173}:5173"
  env_file: .env
  environment:
    PUBLIC_URL: ${PUBLIC_URL}
    BACKEND_URL: ${BACKEND_URL}
  depends_on:
    - backend
```

- Typical pattern:
  - Everything bound to `127.0.0.1`, then served externally via your own nginx/Apache using config in `docs/nginx.conf`.
  - In this setup, **frontend and backend share the same public origin (`https://maxun.my.domain`)**, so CORS issues basically disappear.

---

## 5. Creating and Logging in a User

There is no separate “admin” role; all users share the same capabilities.

- **Register via UI**:
  - Go to frontend (`https://maxun-frontend.fly.dev` or your domain).
  - Use **Register** page to create a user.
- **Register via API**:

```bash
curl -i 'https://maxun-backend.fly.dev/auth/register' \
  -H 'Origin: https://maxun-frontend.fly.dev' \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"your-password"}'
```

- **Login via API**:

```bash
curl -i 'https://maxun-backend.fly.dev/auth/login' \
  -H 'Origin: https://maxun-frontend.fly.dev' \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"your-password"}'
```

---

## 6. Disabling Public Self‑Registration (Optional)

To prevent random users from signing up on your instance, you can disable the `/auth/register` endpoint via an environment variable:

- **Backend env (Fly.io or docker .env):**

  ```bash
  ALLOW_REGISTRATION=false
  ```

- Behavior:
  - When `ALLOW_REGISTRATION` is set to `false` (case‑insensitive), `POST /auth/register` returns **403** with an error payload:

    ```104:157:maxun/server/src/routes/auth.ts
    if (!isRegistrationAllowed) {
      return res.status(403).json({
        error: "REGISTRATION_DISABLED",
        code: "register.error.registration_disabled",
      });
    }
    ```

  - When `ALLOW_REGISTRATION` is unset or set to `true`, registration works normally.


---

**One-sentence summary:** With `VITE_BACKEND_URL` and `PUBLIC_URL` correctly wired into the Docker builds/Fly configs, and with at least one IP allocated to `maxun-backend`, the Fly frontend and backend run as two HTTPS origins (`maxun-frontend.fly.dev` → `maxun-backend.fly.dev`) with fully working CORS and login/registration.  

Reference (for Fly networking/IP behavior, matching the issues we hit): [Fly.io IPs & DNS](https://fly.io/docs/networking/ips-and-dns/).