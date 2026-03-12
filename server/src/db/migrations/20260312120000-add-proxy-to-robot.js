'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('robot');

    if (!table.proxy) {
      await queryInterface.addColumn('robot', 'proxy', {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Optional proxy URL for this robot; overrides default proxy when set'
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('robot');

    if (table.proxy) {
      await queryInterface.removeColumn('robot', 'proxy');
    }
  }
};