// migrations/XXXXXXXXXXXXXX-update-airtable-token-length.js
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('robot', 'airtable_access_token', {
      type: Sequelize.TEXT
    });
    
    await queryInterface.changeColumn('robot', 'airtable_refresh_token', {
      type: Sequelize.TEXT
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('robot', 'airtable_access_token', {
      type: Sequelize.STRING(255)
    });
    
    await queryInterface.changeColumn('robot', 'airtable_refresh_token', {
      type: Sequelize.STRING(255)
    });
  }
};