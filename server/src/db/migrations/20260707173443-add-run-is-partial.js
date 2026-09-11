'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('run');
    if (!tableInfo.isPartial) {
      await queryInterface.addColumn('run', 'isPartial', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
  },

  async down(queryInterface) {
    const tableInfo = await queryInterface.describeTable('run');
    if (tableInfo.isPartial) await queryInterface.removeColumn('run', 'isPartial');
  },
};
