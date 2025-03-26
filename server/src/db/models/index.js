'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Sequelize from 'sequelize';
import databaseConfig from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const config = databaseConfig[env];
const db = {};

let sequelize;
if (config.use_env_variable) {
  try {
    sequelize = new Sequelize(process.env[config.use_env_variable], config);
    console.log(`Connected to database using ${config.use_env_variable}`);
  } catch (error) {
    console.error('Unable to connect to the database using environment variable:', error);
    process.exit(1);
  }
} else {
  try {
    sequelize = new Sequelize(config.database, config.username, config.password, config);
    console.log(`Connected to database: ${config.database}`);
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    process.exit(1);
  }
}

fs
  .readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;