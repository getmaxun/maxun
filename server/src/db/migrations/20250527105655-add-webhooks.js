'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('robot');
    if (!tableInfo.webhooks) {
      await queryInterface.addColumn('robot', 'webhooks', {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: null,
        comment: 'Webhook configurations for the robot'
      });
    }

    const indexes = await queryInterface.showIndex('robot');
    if (!indexes.some(index => index.name === 'robot_webhooks_gin_idx')) {
      await queryInterface.addIndex('robot', {
        fields: ['webhooks'],
        using: 'gin',
        name: 'robot_webhooks_gin_idx'
      });
    }
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex('robot');
    if (indexes.some(index => index.name === 'robot_webhooks_gin_idx')) {
      await queryInterface.removeIndex('robot', 'robot_webhooks_gin_idx');
    }
    const tableInfo = await queryInterface.describeTable('robot');
    if (tableInfo.webhooks) await queryInterface.removeColumn('robot', 'webhooks');
  }
};
