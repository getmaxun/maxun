'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
   
    await queryInterface.addColumn('robot', 'airtable_refresh_token', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
   
    await queryInterface.removeColumn('robot', 'airtable_refresh_token');
  },
};