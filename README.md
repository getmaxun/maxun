<h1 align="center">
    <div>
        <a href="https://www.maxun.dev/?ref=ghread">
            <img src="/src/assets/maxunlogo.png" width="50" />
            <br>
            Maxun
        </a>
    </div>
    Open-Source No-Code Web Data Extraction Platform <br>
</h1>

<p align="center">
Maxun lets you train a robot in 2 minutes and scrape the web on auto-pilot. Web data extraction doesn't get easier than this!
</p>


<p align="center">
    <a href="https://app.maxun.dev/?ref=ghread"><b>Go To App</b></a> |
    <a href="https://docs.maxun.dev/?ref=ghread"><b>Documentation</b></a> |
    <a href="https://www.maxun.dev/?ref=ghread"><b>Website</b></a> |
    <a href="https://discord.gg/5GbPjBUkws"><b>Discord</b></a> |
    <a href="https://x.com/maxun_io?ref=ghread"><b>Twitter</b></a> |
    <a href="https://www.youtube.com/@MaxunOSS?ref=ghread"><b>Watch Tutorials</b></a>
    <br />
    <br />
<a href="https://trendshift.io/repositories/12113" target="_blank"><img src="https://trendshift.io/api/badge/repositories/12113" alt="getmaxun%2Fmaxun | Trendshift" style="width: 250px; height: 55px; margin-top: 10px;" width="250" height="55"/></a>
</p>

![maxun_gif](https://github.com/user-attachments/assets/3e0b0cf8-9e52-44d2-a140-b26b7b481477)

<img src="https://static.scarf.sh/a.png?x-pxid=c12a77cc-855e-4602-8a0f-614b2d0da56a" />

# Getting Started
The simplest & fastest way to get started is to use the hosted version: https://app.maxun.dev. Maxun Cloud deals with anti-bot detection, huge proxy network with automatic proxy rotation, and CAPTCHA solving.

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
1. Ensure you have Node.js, PostgreSQL, MinIO and Redis installed on your system. Check out the [installation guide](./docs/DB%20installation%20guide.md) here!
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
cd ..
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

# How Do I Self-Host?
Checkout community self hosting guide: https://docs.maxun.dev/self-host

# How Does It Work?
Maxun lets you create custom robots which emulate user actions and extract data. A robot can perform any of the actions: <b>Capture List, Capture Text or Capture Screenshot. Once a robot is created, it will keep extracting data for you without manual intervention</b>

![Screenshot 2024-10-23 222138](https://github.com/user-attachments/assets/53573c98-769e-490d-829e-ada9fac0764f)

## 1. Robot Actions
1. Capture List: Useful to extract structured and bulk items from the website. Example: Scrape products from Amazon etc.
2. Capture Text: Useful to extract individual text content from the website.
3. Capture Screenshot: Get fullpage or visible section screenshots of the website.

## 2. BYOP
BYOP (Bring Your Own Proxy) lets you connect external proxies to bypass anti-bot protection. Currently, the proxies are per user. Soon you'll be able to configure proxy per robot.


# Features
- ✨ Extract Data With No-Code
- ✨ Handle Pagination & Scrolling
- ✨ Run Robots On A Specific Schedule
- ✨ Turn Websites to APIs
- ✨ Turn Websites to Spreadsheets
- ✨ Adapt To Website Layout Changes
- ✨ Extract Behind Login
- ✨ Integrations
- ✨ MCP Server
- ✨ Bypass 2FA & MFA For Extract Behind Login (coming soon)
- +++ A lot of amazing things!

# Screenshots
![Maxun PH Launch (1)-1-1](https://github.com/user-attachments/assets/d7c75fa2-2bbc-47bb-a5f6-0ee6c162f391)
![Maxun PH Launch (1)-2-1](https://github.com/user-attachments/assets/d85a3ec7-8ce8-4daa-89aa-52d9617e227a)
![Maxun PH Launch (1)-3-1](https://github.com/user-attachments/assets/4bd5a0b4-485d-44f4-a487-edd9afc18b11)
![Maxun PH Launch (1)-4-1](https://github.com/user-attachments/assets/78140675-a6b6-49b2-981f-6a3d9a32b0b9)
![Maxun PH Launch (1)-5-1](https://github.com/user-attachments/assets/d9fe8519-c81c-4e45-92f2-b2939bf24192)
![Maxun PH Launch (1)-6-1](https://github.com/user-attachments/assets/c26e9ae3-c3da-4280-826a-c7cdf913fb93)
![Maxun PH Launch (1)-7-1](https://github.com/user-attachments/assets/fd7196f4-a6dc-4c4c-9c76-fdd93fac8247)
![Maxun PH Launch (1)-8-1](https://github.com/user-attachments/assets/16ee4a71-772a-49ae-a0e5-cb0529519bda)
![Maxun PH Launch (1)-9-1](https://github.com/user-attachments/assets/160f46fa-0357-4c1b-ba50-b4fe64453bb7)

# Note
This project is in early stages of development. Your feedback is very important for us - we're actively working on improvements. </a>

# License
<p>
This project is licensed under <a href="./LICENSE">AGPLv3</a>.
</p>

# Support Us
Star the repository, contribute if you love what we’re building, or make a [one-time donation](https://bit.ly/maxun-oss). Every little bit helps us keep the lights on and the robots running.

# Contributors
Thank you to the combined efforts of everyone who contributes!

<a href="https://github.com/getmaxun/maxun/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=getmaxun/maxun" />
</a>
