'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add new Airtable-related columns to the 'robot' table
    await queryInterface.addColumn('robot', 'airtable_base_id', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('robot', 'airtable_table_name', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('robot', 'airtable_api_key', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('robot', 'airtable_access_token', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    // Remove Airtable-related columns from the 'robot' table
    await queryInterface.removeColumn('robot', 'airtable_base_id');
    await queryInterface.removeColumn('robot', 'airtable_table_name');
    await queryInterface.removeColumn('robot', 'airtable_api_key');
    await queryInterface.removeColumn('robot', 'airtable_access_token');
  },
};
