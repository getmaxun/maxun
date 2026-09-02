# Self hosting docker guide

So you want to create a bot? Let's get you started!

## Requirements (not covered)
- Webserver (Apache2, nginx, etc.)
- SSL Certificates (letsencrypt, zerossl, etc)
- A sub-domain to host maxun i.e. maxun.my.domain
- Docker
- Docker compose
- Probably others...

## Guide
For this guide, we assume that before you start, you have a dedicated docker folder to house config files and everything else we need for persistence between docker container reboots and updates. The path in this guide is `/home/$USER/Docker/maxun`.
1. Change directory into your docker folder `cd /home/$USER/Docker/`
2. Create a new directory for maxun and all the required sub-folders for our docker services `mkdir -p maxun/{db,minio,redis}`
3. Change directory to enter the newly created folder `cd maxun`
4. Create your `.env` file. Use **either** option below.

   **Option A — generate it automatically (recommended)**

     From the root of a cloned Maxun repo (`maxun/`), run the generator (it lives in `docs/`):

   ```bash
   bash docs/generate-env.sh
   ```

   If your current directory is `maxun/docs` instead, run:

   ```bash
   bash generate-env.sh
   ```
 
   It writes `.env` into the current directory, so run it from the same folder
   your `docker-compose.yml` will live in. Requires `openssl` and bash — on
   Windows, use WSL or Git Bash.

   **Option B — write it yourself**

   Run each command below and paste its output after the matching `=`:

   ```bash
   openssl rand -base64 48   # JWT_SECRET
   openssl rand -base64 24   # DB_PASSWORD
   openssl rand -hex 32      # ENCRYPTION_KEY  (must be 64 hex characters)
   openssl rand -base64 48   # SESSION_SECRET
   openssl rand -base64 24   # MINIO_SECRET_KEY
   ```

   Then create the file with `nano .env` and paste in the following, replacing
   each placeholder with the matching output above:

   ```dotenv
   NODE_ENV=production
   JWT_SECRET=<output of first command>
   DB_NAME=maxun
   DB_USER=postgres
   DB_PASSWORD=<output of second command>
   DB_HOST=postgres
   DB_PORT=5432
   ENCRYPTION_KEY=<output of third command>
   SESSION_SECRET=<output of fourth command>
   MINIO_ENDPOINT=minio
   MINIO_PORT=9000
   MINIO_CONSOLE_PORT=9001
   MINIO_ACCESS_KEY=minio
   MINIO_SECRET_KEY=<output of fifth command>
   REDIS_HOST=maxun-redis
   REDIS_PORT=6379
   REDIS_PASSWORD=
   BACKEND_PORT=8080
   FRONTEND_PORT=5173
   BACKEND_URL=https://maxun.my.domain
   PUBLIC_URL=https://maxun.my.domain
   VITE_BACKEND_URL=https://maxun.my.domain
   VITE_PUBLIC_URL=https://maxun.my.domain
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   GOOGLE_REDIRECT_URI=
   AIRTABLE_CLIENT_ID=
   AIRTABLE_REDIRECT_URI=
   MAXUN_TELEMETRY=true
   ```

   Save with Ctrl + X, Y, Enter.

   > Do not put a literal dollar sign in any value. Docker Compose reads it as
   > a variable reference and silently drops it, leaving you with a shorter
   > secret than you pasted. Double it to escape one.

6. Whichever option you used, READ the file and change the variables to match
   your environment — in particular `BACKEND_URL`, `PUBLIC_URL`,
   `VITE_BACKEND_URL`, `VITE_PUBLIC_URL`, and any ports you need to change
   (i.e. `BACKEND_PORT=30000`).

7. Create a file for docker compose `nano docker-compose.yml` with the following contents:
```yml
services:
  postgres:
    image: postgres:17
    container_name: maxun-postgres
    mem_limit: 512M
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    volumes:
      - /home/$USER/Docker/maxun/db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: docker.io/library/redis:7
    container_name: maxun-redis
    restart: always
    mem_limit: 128M
    volumes:
      - /home/$USER/Docker/maxun/redis:/data

  minio:
    image: minio/minio
    container_name: maxun-minio
    mem_limit: 512M
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    command: server /data --console-address :${MINIO_CONSOLE_PORT:-9001}
    volumes:
      - /home/$USER/Docker/maxun/minio:/data

  backend:
    image: getmaxun/maxun-backend:latest
    container_name: maxun-backend
    ports:
      - "127.0.0.1:${BACKEND_PORT:-8080}:${BACKEND_PORT:-8080}"
    env_file: .env
    environment:
      BACKEND_URL: ${BACKEND_URL}
      PLAYWRIGHT_BROWSERS_PATH: /ms-playwright
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: 0
      # DEBUG: pw:api
      # PWDEBUG: 1  # Enables debugging
      CHROMIUM_FLAGS: '--disable-gpu --no-sandbox --headless=new'
    security_opt:
      - seccomp=unconfined  # This might help with browser sandbox issues
    shm_size: '2gb'
    mem_limit: 4g
    depends_on:
      - postgres
      - minio
    volumes:
      - /var/run/dbus:/var/run/dbus

  frontend:
    image: getmaxun/maxun-frontend:latest
    container_name: maxun-frontend
    mem_limit: 512M
    ports:
      - "127.0.0.1:${FRONTEND_PORT:-5173}:5173"
    env_file: .env
    environment:
      PUBLIC_URL: ${PUBLIC_URL}
      BACKEND_URL: ${BACKEND_URL}
    depends_on:
      - backend
```
7. Ctrl + x, Y, Enter will save your changes
8. This particular setup is "production ready" meaning that maxun is only accessible from localhost. You must configure a reverse proxy to access it!
9. Start maxun `sudo docker compose up -d` or `sudo docker-compose up -d`
10. Wait 30 seconds for everything to come up
11. Access your maxun instance at http://localhost:5173 if using defaults

## Next steps
You will want to configure a reverse proxy. Click on a link below to check out some examples.
- [Nginx](nginx.conf)
