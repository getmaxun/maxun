'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('run');

    // Only add the column if it doesn't exist
    if (!tableInfo.retryCount) {
      await queryInterface.addColumn('run', 'retryCount', {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 0,
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('run', 'retryCount');
  }
};
