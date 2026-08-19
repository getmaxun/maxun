'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('recorder_draft')) {
      await queryInterface.createTable('recorder_draft', {
        id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
        userId: { type: Sequelize.INTEGER, allowNull: false },
        url: { type: Sequelize.TEXT, allowNull: false },
        name: { type: Sequelize.STRING(200), allowNull: false },
        description: { type: Sequelize.TEXT, allowNull: true },
        status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'discovered' },
        state: { type: Sequelize.JSONB, allowNull: false },
        compiledRobotId: { type: Sequelize.UUID, allowNull: true },
        lastError: { type: Sequelize.TEXT, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });
    }
    const indexes = await queryInterface.showIndex('recorder_draft');
    if (!indexes.some(index => index.fields?.map(field => field.attribute).join(',') === 'userId')) {
      await queryInterface.addIndex('recorder_draft', ['userId']);
    }
    if (!indexes.some(index => index.fields?.map(field => field.attribute).join(',') === 'userId,updatedAt')) {
      await queryInterface.addIndex('recorder_draft', ['userId', 'updatedAt']);
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('recorder_draft')) await queryInterface.dropTable('recorder_draft');
  },
};
