import express from 'express';
import path from 'path';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
import { record, workflow, storage, auth, integration, proxy } from './routes';
import { BrowserPool } from "./browser-management/classes/BrowserPool";
import logger from './logger';
import { connectDB, syncDB } from './storage/db'
import cookieParser from 'cookie-parser';
import { SERVER_PORT } from "./constants/config";
import { Server } from "socket.io";
import { readdirSync } from "fs"
import { fork } from 'child_process';
import { capture } from "./utils/analytics";
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './swagger/config';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import session from 'express-session';
import Run from './models/Run';

const app = express();
app.use(cors({
  origin: process.env.PUBLIC_URL ? process.env.PUBLIC_URL : 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

const { Pool } = pg;
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
});

const PgSession = connectPgSimple(session);

app.use(
  session({
    store: new PgSession({
      pool: pool,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    secret: 'mx-session',
    resave: false, // Do not resave the session if it hasn't changed
    saveUninitialized: true, // Save new sessions
    cookie: {
      secure: false, // Set to true if using HTTPS
      maxAge: 24 * 60 * 60 * 1000, // 1-day session expiration
    },
  })
);

const server = http.createServer(app);

/**
 * Globally exported singleton instance of socket.io for socket communication with the client.
 * @type {Server}
 */
export const io = new Server(server);

/**
 * {@link BrowserPool} globally exported singleton instance for managing browsers.
 */
export const browserPool = new BrowserPool();

// app.use(bodyParser.json({ limit: '10mb' }))
// app.use(bodyParser.urlencoded({ extended: true, limit: '10mb', parameterLimit: 9000 }));
// parse cookies - "cookie" is true in csrfProtection
app.use(cookieParser())

app.use('/record', record);
app.use('/workflow', workflow);
app.use('/storage', storage);
app.use('/auth', auth);
app.use('/integration', integration);
app.use('/proxy', proxy);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

readdirSync(path.join(__dirname, 'api')).forEach((r) => {
  const route = require(path.join(__dirname, 'api', r));
  const router = route.default || route;  // Use .default if available, fallback to route
  if (typeof router === 'function') {
    app.use('/api', router);  // Use the default export or named router
  } else {
    console.error(`Error: ${r} does not export a valid router`);
  }
});

const isProduction = process.env.NODE_ENV === 'production';
const workerPath = path.resolve(__dirname, isProduction ? './schedule-worker.js' : './schedule-worker.ts');
const recordingWorkerPath = path.resolve(__dirname, isProduction ? './pgboss-worker.js' : './pgboss-worker.ts');

let workerProcess: any;
let recordingWorkerProcess: any;

if (!isProduction) {
  workerProcess = fork(workerPath, [], {
    execArgv: ['--inspect=5859'],
  });
  workerProcess.on('message', (message: any) => {
    console.log(`Message from worker: ${message}`);
  });
  workerProcess.on('error', (error: any) => {
    console.error(`Error in worker: ${error}`);
  });
  workerProcess.on('exit', (code: any) => {
    console.log(`Worker exited with code: ${code}`);
  });

  recordingWorkerProcess = fork(recordingWorkerPath, [], {
    execArgv: ['--inspect=5860'],
  });
  recordingWorkerProcess.on('message', (message: any) => {
    console.log(`Message from recording worker: ${message}`);
  });
  recordingWorkerProcess.on('error', (error: any) => {
    console.error(`Error in recording worker: ${error}`);
  });
  recordingWorkerProcess.on('exit', (code: any) => {
    console.log(`Recording worker exited with code: ${code}`);
  });
}

app.get('/', function (req, res) {
  capture(
    'maxun-oss-server-run', {
    event: 'server_started',
  }
  );
  return res.send('Maxun server started 🚀');
});

// Add CORS headers
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

server.listen(SERVER_PORT, '0.0.0.0', async () => {
  try {
    await connectDB();
    await syncDB();
    logger.log('info', `Server listening on port ${SERVER_PORT}`);
  } catch (error: any) {
    logger.log('error', `Failed to connect to the database: ${error.message}`);
    process.exit(1); // Exit the process if DB connection fails
  }
});

process.on('SIGINT', async () => {
  console.log('Main app shutting down...');
  try {
    await Run.update(
      {
        status: 'failed',
        finishedAt: new Date().toLocaleString(),
        log: 'Process interrupted during execution - worker shutdown'
      },
      {
        where: { status: 'running' }
      }
    );
  } catch (error: any) {
    console.error('Error updating runs:', error);
  }

  try {
    console.log('Closing PostgreSQL connection pool...');
    await pool.end();
    console.log('PostgreSQL connection pool closed');
  } catch (error) {
    console.error('Error closing PostgreSQL connection pool:', error);
  }

  if (!isProduction) {
    if (workerProcess) workerProcess.kill();
    if (recordingWorkerProcess) recordingWorkerProcess.kill();
  }
  process.exit();
});
