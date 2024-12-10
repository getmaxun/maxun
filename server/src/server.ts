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
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import csrf from 'csurf';
import { SERVER_PORT } from "./constants/config";
import { Server } from "socket.io";
import { readdirSync } from "fs"
import { fork } from 'child_process';
import { capture } from "./utils/analytics";
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './swagger/config';

const app = express();
app.use(cors({
  origin: process.env.PUBLIC_URL ? process.env.PUBLIC_URL : 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

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
const workerPath = path.resolve(__dirname, isProduction ? './worker.js' : './worker.ts');

let workerProcess: any;
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

process.on('SIGINT', () => {
  console.log('Main app shutting down...');
  if (!isProduction) {
    workerProcess.kill();
  }
  process.exit();
});
