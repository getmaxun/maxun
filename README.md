<h1 align="center">
    <div>
        <a href="https://maxun-website.vercel.app/">
            <img src="/public/img/maxunlogo.png" width="50" />
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
    <a href="https://maxun-website.vercel.app/"><b>Website</b></a> |
    <a href="https://discord.com/invite/NFhWDCdb"><b>Discord</b></a> |
    <a href="https://x.com/maxun_io"><b>Twitter</b></a> |
    <a href="https://docs.google.com/forms/d/e/1FAIpQLSdbD2uhqC4sbg4eLZ9qrFbyrfkXZ2XsI6dQ0USRCQNZNn5pzg/viewform"><b>Join Maxun Cloud</b></a>
</p>

![maxun_demo](https://github.com/user-attachments/assets/a61ba670-e56a-4ae1-9681-0b4bd6ba9cdc)

<img src="https://static.scarf.sh/a.png?x-pxid=c12a77cc-855e-4602-8a0f-614b2d0da56a" />

# Local Setup
### Docker
```
docker-compose up -d --build
```

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

# start frontend and backend together
npm run start
```
You can access the frontend at http://localhost:5173/ and backend at http://localhost:8080/


# Envirnoment Variables
| Variable              | Mandatory | Description                                                                                  | If Not Set                                                   |
|-----------------------|-----------|----------------------------------------------------------------------------------------------|--------------------------------------------------------------|
| `NODE_ENV`            | Yes       | Defines the app environment (`development`, `production`).                                   | Defaults to `development`. |
| `JWT_SECRET`          | Yes       | Secret key used to sign and verify JSON Web Tokens (JWTs) for authentication.                | JWT authentication will not work.                            |
| `DB_NAME`             | Yes       | Name of the Postgres database to connect to.                                                 | Database connection will fail.                               |
| `DB_USER`             | Yes       | Username for Postgres database authentication.                                               | Database connection will fail.                               |
| `DB_PASSWORD`         | Yes       | Password for Postgres database authentication.                                               | Database connection will fail.                               |
| `DB_HOST`             | Yes       | Host address where the Postgres database server is running.                                  | Database connection will fail.                               |
| `DB_PORT`             | Yes       | Port number used to connect to the Postgres database server.                                 | Database connection will fail.                               |
| `ENCRYPTION_KEY`      | Yes       | Key used for encrypting sensitive data (proxies, passwords).                                 | Encryption functionality will not work.                      |
| `MINIO_ENDPOINT`      | Yes       | Endpoint URL for MinIO, to store Robot Run Screenshots.                                      | Connection to MinIO storage will fail.                       |
| `MINIO_PORT`          | Yes       | Port number for MinIO service.                                                               | Connection to MinIO storage will fail.                       |
| `MINIO_ACCESS_KEY`    | Yes       | Access key for authenticating with MinIO.                                                    | MinIO authentication will fail.                              |
| `GOOGLE_CLIENT_ID`    | No       | Client ID for Google OAuth, used for Google Sheet integration authentication.                 | Google login will not work.                                  |
| `GOOGLE_CLIENT_SECRET`| No       | Client Secret for Google OAuth.                                                              | Google login will not work.                                  |
| `GOOGLE_REDIRECT_URI` | No       | Redirect URI for handling Google OAuth responses.                                            | Google login will not work.                                  |
| `REDIS_HOST`          | Yes       | Host address of the Redis server, used by BullMQ for scheduling robots.                     | Redis connection will fail. |
| `REDIS_PORT`          | Yes       | Port number for the Redis server.                                                            | Redis connection will fail. |
| `MAXUN_TELEMETRY`     | No        | Disables telemetry to stop sending anonymous usage data. Keeping it enabled helps us understand how the product is used and assess the impact of any new changes. Please keep it enabled. | Telemetry data will not be collected. |



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
- ✨ Adapt To Website Layout Changes (coming soon)
- ✨ Extract Behind Login, With Two-Factor Authentication Support (coming soon)
- ✨ Integrations (currently Google Sheet)
- +++ A lot of amazing things soon!

# Cloud
We offer a managed cloud version to run Maxun without having to manage the infrastructure and extract data at scale. Maxun cloud also deals with anti-bot detection, huge proxy network with automatic proxy rotation, and CAPTCHA solving. If this interests you, [join the cloud waitlist](https://docs.google.com/forms/d/e/1FAIpQLSdbD2uhqC4sbg4eLZ9qrFbyrfkXZ2XsI6dQ0USRCQNZNn5pzg/viewform) as we launch soon.

# Note
This project is in early stages of development. Your feedback is very important for us - we're actively working to improve the product. <a href="https://forms.gle/E8vRMVB7bUbsSktPA">Drop anonymous feedback here.</a>

# License
<p>
This project is licensed under <a href="./LICENSE">AGPLv3</a>.
</p>

# Contributors
Thank you to the combined efforts of everyone who contributes!

<a href="https://github.com/getmaxun/maxun/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=getmaxun/maxun" />
</a>
