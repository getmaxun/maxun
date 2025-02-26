'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('robot', 'airtable_table_id', {
      type: Sequelize.TEXT
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('robot', 'airtable_table_id', {
      type: Sequelize.TEXT
    });
  }
};
