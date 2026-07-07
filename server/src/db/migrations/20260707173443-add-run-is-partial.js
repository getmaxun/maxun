'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('run', 'isPartial', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: 'True when a failed/aborted run still has partial serializableOutput/binaryOutput worth surfacing'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('run', 'isPartial');
  }
};
