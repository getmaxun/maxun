'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('run', 'hasChanges', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: 'True when the run output differs from the previous run of the robot (compare runs)'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('run', 'hasChanges');
  }
};
