'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add Airtable related columns
    return queryInterface.sequelize.transaction(async (transaction) => {
      try {
        // Check if columns already exist first to make the migration idempotent
        const tableInfo = await queryInterface.describeTable('robot', { transaction });
        
        // Add airtable_base_id if it doesn't exist
        if (!tableInfo.airtable_base_id) {
          await queryInterface.addColumn('robot', 'airtable_base_id', {
            type: Sequelize.STRING,
            allowNull: true
          }, { transaction });
        }
        
        // Add airtable_base_name if it doesn't exist
        if (!tableInfo.airtable_base_name) {
          await queryInterface.addColumn('robot', 'airtable_base_name', {
            type: Sequelize.STRING,
            allowNull: true
          }, { transaction });
        }
        
        // Add airtable_table_name if it doesn't exist
        if (!tableInfo.airtable_table_name) {
          await queryInterface.addColumn('robot', 'airtable_table_name', {
            type: Sequelize.STRING,
            allowNull: true
          }, { transaction });
        }
        
        // Add airtable_table_id if it doesn't exist
        if (!tableInfo.airtable_table_id) {
          await queryInterface.addColumn('robot', 'airtable_table_id', {
            type: Sequelize.STRING,
            allowNull: true
          }, { transaction });
        }
        
        // Add airtable_access_token if it doesn't exist
        if (!tableInfo.airtable_access_token) {
          await queryInterface.addColumn('robot', 'airtable_access_token', {
            type: Sequelize.TEXT, // Using TEXT for potentially long tokens
            allowNull: true
          }, { transaction });
        }
        
        // Add airtable_refresh_token if it doesn't exist
        if (!tableInfo.airtable_refresh_token) {
          await queryInterface.addColumn('robot', 'airtable_refresh_token', {
            type: Sequelize.TEXT, // Using TEXT for potentially long tokens
            allowNull: true
          }, { transaction });
        }
        
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error);
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Remove Airtable related columns
    return queryInterface.sequelize.transaction(async (transaction) => {
      try {
        // Remove columns in reverse order
        await queryInterface.removeColumn('robot', 'airtable_refresh_token', { transaction });
        await queryInterface.removeColumn('robot', 'airtable_access_token', { transaction });
        await queryInterface.removeColumn('robot', 'airtable_table_id', { transaction });
        await queryInterface.removeColumn('robot', 'airtable_table_name', { transaction });
        await queryInterface.removeColumn('robot', 'airtable_base_name', { transaction });
        await queryInterface.removeColumn('robot', 'airtable_base_id', { transaction });
        
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error);
      }
    });
  }
};