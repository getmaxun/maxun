'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('maxun_control_lease');
    if (!tableInfo.observationReady) {
      await queryInterface.addColumn('maxun_control_lease', 'observationReady', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      });
    }
  },

  async down(queryInterface) {
    const tableInfo = await queryInterface.describeTable('maxun_control_lease');
    if (tableInfo.observationReady) await queryInterface.removeColumn('maxun_control_lease', 'observationReady');
  },
};
