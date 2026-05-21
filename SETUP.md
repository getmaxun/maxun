# Local Installation
1. Create a root folder for your project (e.g. 'maxun')
2. Create a file named `.env` in the root folder of the project
3. Example env file can be viewed [here](https://github.com/getmaxun/maxun/blob/master/ENVEXAMPLE). Copy all content of example env to your `.env` file.
4. Choose your installation method below

### Docker Compose
1. Copy paste the [docker-compose.yml file](https://github.com/getmaxun/maxun/blob/master/docker-compose.yml) into your root folder 
2. Ensure you have setup the `.env` file in that same folder
3. Run the command below from a terminal
```
docker-compose up -d
```
You can access the frontend at http://localhost:5173/ and backend at http://localhost:8080/

### Without Docker
1. Ensure you have Node.js, PostgreSQL, MinIO and Redis installed on your system.
2. Run the commands below
```
git clone https://github.com/getmaxun/maxun

# change directory to the project root
cd maxun

# install dependencies
npm install

# change directory to maxun-core to install dependencies
cd maxun-core 
npm install

# get back to the root directory
cd ..

# install chromium and its dependencies
npx playwright install --with-deps chromium

# get back to the root directory
cd ..

# start frontend and backend together
npm run start
```
You can access the frontend at http://localhost:5173/ and backend at http://localhost:8080/


# Environment Variables
1. Create a file named `.env` in the root folder of the project
2. Example env file can be viewed [here](https://github.com/getmaxun/maxun/blob/master/ENVEXAMPLE).

| Variable              | Mandatory | Description                                                                                  | If Not Set                                                   |
|-----------------------|-----------|----------------------------------------------------------------------------------------------|--------------------------------------------------------------|
| `BACKEND_PORT`            | Yes       | Port to run backend on. Needed for Docker setup                                          | Default value: 8080 |
| `FRONTEND_PORT`            | Yes       | Port to run frontend on. Needed for Docker setup                                        | Default value: 5173 |
| `BACKEND_URL`            | Yes       | URL to run backend on.                                                                    | Default value: http://localhost:8080 |
| `VITE_BACKEND_URL`            | Yes       | URL used by frontend to connect to backend                                           | Default value: http://localhost:8080 |
| `PUBLIC_URL`            | Yes       | URL to run frontend on.                                                                    | Default value: http://localhost:5173 |
| `VITE_PUBLIC_URL`            | Yes       | URL used by backend to connect to frontend                                           | Default value: http://localhost:5173 |
| `JWT_SECRET`          | Yes       | Secret key used to sign and verify JSON Web Tokens (JWTs) for authentication.                | JWT authentication will not work.                            |
| `DB_NAME`             | Yes       | Name of the Postgres database to connect to.                                                 | Database connection will fail.                               |
| `DB_USER`             | Yes       | Username for Postgres database authentication.                                               | Database connection will fail.                               |
| `DB_PASSWORD`         | Yes       | Password for Postgres database authentication.                                               | Database connection will fail.                               |
| `DB_HOST`             | Yes       | Host address where the Postgres database server is running.                                  | Database connection will fail.                               |
| `DB_PORT`             | Yes       | Port number used to connect to the Postgres database server.                                 | Database connection will fail.                               |
| `ENCRYPTION_KEY`      | Yes       | Key used for encrypting sensitive data (proxies, passwords).                                 | Encryption functionality will not work.                      |
| `SESSION_SECRET`      | No       | A strong, random string used to sign session cookies                                          | Uses default secret. Recommended to define your own session secret to avoid session hijacking.  |
| `MINIO_ENDPOINT`      | Yes       | Endpoint URL for MinIO, to store Robot Run Screenshots.                                      | Connection to MinIO storage will fail.                       |
| `MINIO_PORT`          | Yes       | Port number for MinIO service.                                                               | Connection to MinIO storage will fail.                       |
| `MINIO_CONSOLE_PORT`          | No       | Port number for MinIO WebUI service. Needed for Docker setup.                         | Cannot access MinIO Web UI. |
| `MINIO_ACCESS_KEY`    | Yes       | Access key for authenticating with MinIO.                                                    | MinIO authentication will fail.                              |
| `GOOGLE_CLIENT_ID`    | No       | Client ID for Google OAuth. Used for Google Sheet integration authentication.                 | Google login will not work.                                  |
| `GOOGLE_CLIENT_SECRET`| No       | Client Secret for Google OAuth. Used for Google Sheet integration authentication.            | Google login will not work.   |
| `GOOGLE_REDIRECT_URI` | No       | Redirect URI for handling Google OAuth responses.                                            | Google login will not work.                                  |
| `AIRTABLE_CLIENT_ID` | No       | Client ID for Airtable, used for Airtable integration authentication.                         | Airtable login will not work.  |
| `AIRTABLE_REDIRECT_URI` | No    | Redirect URI for handling Airtable OAuth responses.                                           | Airtable login will not work.  |
| `MAXUN_TELEMETRY`     | No        | Disables telemetry to stop sending anonymous usage data. Keeping it enabled helps us understand how the product is used and assess the impact of any new changes. Please keep it enabled. | Telemetry data will not be collected. |

---

## Troubleshooting

### Database Connection Fails

**Symptom**: Backend shows `ECONNREFUSED` or `connection refused` errors on startup.

**Causes & Solutions**:
- PostgreSQL is not running: `sudo systemctl start postgresql` (Linux) or start the Postgres app (macOS)
- Wrong `DB_HOST` / `DB_PORT`: Verify the host and port match your Postgres installation. Default: `localhost:5432`
- Wrong credentials: Ensure `DB_NAME`, `DB_USER`, and `DB_PASSWORD` in `.env` match your Postgres database
- Docker: If using Docker, `DB_HOST` should be `postgres` (the service name in docker-compose), not `localhost`

### MinIO / Storage Errors

**Symptom**: Screenshots not saving, `MinIO endpoint unreachable`, or `Access Key Id does not match`.

**Causes & Solutions**:
- MinIO not running: `sudo systemctl start minio` (Linux) or start MinIO app (macOS/Windows)
- Wrong `MINIO_ENDPOINT`: If running locally without Docker, use `localhost`. With Docker, use the service name `minio`
- Wrong credentials: `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` must match what MinIO was initialized with
- MinIO console: Access at `http://localhost:9001` to verify the bucket `maxun` exists

### Redis Connection Errors

**Symptom**: `Redis connection refused` or `ECONNREFUSED`.

**Causes & Solutions**:
- Redis not running: `sudo systemctl start redis` (Linux)
- Wrong `REDIS_HOST`: In Docker Compose, use `redis`. Locally, use `localhost`
- No password: If `REDIS_PASSWORD` is empty, ensure it is not set to a space or invisible character

### Playwright / Browser Errors

**Symptom**: `Browser closed unexpectedly`, `Chromium not found`, or Playwright crashes on startup.

**Causes & Solutions**:
- Playwright not installed: Run `npx playwright install --with-deps chromium`
- Sandbox issues on Linux: Add `--no-sandbox` to browser launch flags if running as root
- Missing system deps (Linux): `sudo apt install -y libnss3 libxss1 libasound2` (Debian/Ubuntu)
- Docker shm size: Increase `--shm-size=2gb` in docker-compose if browser crashes with memory errors

### JWT / Authentication Failures

**Symptom**: Login does not work, tokens rejected, `JWT Malformed` errors.

**Causes & Solutions**:
- Missing `JWT_SECRET`: Must be set. Generate with `openssl rand -base64 48`
- Mismatched secrets: If you change `JWT_SECRET`, existing sessions become invalid — clear browser cookies
- Clock skew: Ensure server time is correct (`timedatectl status` on Linux)

### CORS Errors in Browser Console

**Symptom**: `Access-Control-Allow-Origin` errors when frontend calls backend.

**Causes & Solutions**:
- Backend URL mismatch: Ensure `BACKEND_URL`, `VITE_BACKEND_URL`, `PUBLIC_URL`, and `VITE_PUBLIC_URL` all use the correct protocol (`http` vs `https`) and port
- Reverse proxy: If behind nginx/Caddy, ensure the proxy sets appropriate CORS headers

### Docker: Container Keeps Restarting

**Symptom**: `docker compose up -d` succeeds but containers exit immediately.

**Causes & Solutions**:
- Check logs: `docker compose logs backend` or `docker compose logs frontend`
- Port conflicts: Ensure `BACKEND_PORT` and `FRONTEND_PORT` are not already in use
- Volume permissions: On Linux, ensure the Docker user has read/write access to the bind-mounted directories

### Performance Issues

- Increase `shm_size` in docker-compose for Playwright (recommended: `2gb`)
- Limit Playwright browsers: Set `MAX_CONCURRENT_BROWSERS=1` if running on low-memory systems
- Database: Ensure PostgreSQL has sufficient `shared_buffers` (recommended: 1/4 of RAM)
