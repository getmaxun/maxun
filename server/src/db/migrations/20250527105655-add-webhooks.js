'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('robot');

    // Only add the column if it doesn't exist
    if (!tableInfo.webhooks) {
      await queryInterface.addColumn('robot', 'webhooks', {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: null,
        comment: 'Webhook configurations for the robot'
      });
    }

    // Check if index exists before adding
    const indexes = await queryInterface.showIndex('robot');
    const indexExists = indexes.some(index => index.name === 'robot_webhooks_gin_idx');

    if (!indexExists && tableInfo.webhooks) {
      await queryInterface.addIndex('robot', {
        fields: ['webhooks'],
        using: 'gin', // GIN index for JSONB columns
        name: 'robot_webhooks_gin_idx'
      });
    }
  },

  async down(queryInterface, Sequelize) {
    // Check if index exists before removing
    const indexes = await queryInterface.showIndex('robot');
    const indexExists = indexes.some(index => index.name === 'robot_webhooks_gin_idx');

    if (indexExists) {
      await queryInterface.removeIndex('robot', 'robot_webhooks_gin_idx');
    }

    // Check if column exists before removing
    const tableInfo = await queryInterface.describeTable('robot');
    if (tableInfo.webhooks) {
      await queryInterface.removeColumn('robot', 'webhooks');
    }
  }
};