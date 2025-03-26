'use strict';

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  try {
    console.log('Testing database connection...');
    await db.sequelize.authenticate();
    console.log('Database connection established successfully.');
    
    console.log('Running database migrations...');
    execSync('npx sequelize-cli db:migrate', { 
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '../../..') 
    });
    console.log('Migrations completed successfully');
    return true;
  } catch (error) {
    console.error('Migration error:', error);
    return false;
  }
}

module.exports = runMigrations;