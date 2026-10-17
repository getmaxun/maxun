/** Keeps the server logger's files out of the repository during tests. Import before any server module. */
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.LOGS_PATH = process.env.LOGS_PATH || fs.mkdtempSync(path.join(os.tmpdir(), 'maxun-ai-extract-test-logs-'));
