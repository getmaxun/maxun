'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const process = require('process');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const config = require('../config/database.js')[env];
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