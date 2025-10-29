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
