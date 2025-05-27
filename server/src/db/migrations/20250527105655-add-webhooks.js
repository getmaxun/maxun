'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('robot', 'webhooks', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: null,
      comment: 'Webhook configurations for the robot'
    });

    // Optional: Add an index for better query performance if you plan to search within webhook data
    await queryInterface.addIndex('robot', {
      fields: ['webhooks'],
      using: 'gin', // GIN index for JSONB columns
      name: 'robot_webhooks_gin_idx'
    });
  },

  async down(queryInterface, Sequelize) {
    // Remove the index first
    await queryInterface.removeIndex('robot', 'robot_webhooks_gin_idx');
    
    // Then remove the column
    await queryInterface.removeColumn('robot', 'webhooks');
  }
};