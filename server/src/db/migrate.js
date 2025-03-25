'use strict';

const { execSync } = require('child_process');
const path = require('path');
const db = require('./models');

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