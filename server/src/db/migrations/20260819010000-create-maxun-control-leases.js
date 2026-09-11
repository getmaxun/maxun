'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('maxun_control_lease')) {
      await queryInterface.createTable('maxun_control_lease', {
        id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
        userId: { type: Sequelize.INTEGER, allowNull: false },
        browserSessionId: { type: Sequelize.STRING(255), allowNull: false },
        ownerSessionId: { type: Sequelize.STRING(255), allowNull: false },
        actor: { type: Sequelize.STRING(16), allowNull: false },
        controlEpoch: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
        active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        expiresAt: { type: Sequelize.DATE, allowNull: false },
        heartbeatAt: { type: Sequelize.DATE, allowNull: false },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });
    }
    let indexes = await queryInterface.showIndex('maxun_control_lease');
    if (!indexes.some(index => index.name === 'maxun_control_lease_browser_unique')) {
      await queryInterface.addIndex('maxun_control_lease', ['userId', 'browserSessionId'], {
        unique: true,
        name: 'maxun_control_lease_browser_unique',
      });
    }
    indexes = await queryInterface.showIndex('maxun_control_lease');
    if (!indexes.some(index => index.name === 'maxun_control_lease_owner_idx')) {
      await queryInterface.addIndex('maxun_control_lease', ['userId', 'ownerSessionId'], {
        name: 'maxun_control_lease_owner_idx',
      });
    }

    if (!tables.includes('maxun_control_command')) {
      await queryInterface.createTable('maxun_control_command', {
        id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
        userId: { type: Sequelize.INTEGER, allowNull: false },
        browserSessionId: { type: Sequelize.STRING(255), allowNull: false },
        ownerSessionId: { type: Sequelize.STRING(255), allowNull: false },
        actor: { type: Sequelize.STRING(16), allowNull: false },
        controlEpoch: { type: Sequelize.INTEGER, allowNull: false },
        commandId: { type: Sequelize.STRING(255), allowNull: false },
        commandType: { type: Sequelize.STRING(32), allowNull: false },
        mode: { type: Sequelize.STRING(16), allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        finishedAt: { type: Sequelize.DATE, allowNull: true },
      });
    }
    indexes = await queryInterface.showIndex('maxun_control_command');
    if (!indexes.some(index => index.name === 'maxun_control_command_replay_unique')) {
      await queryInterface.addIndex('maxun_control_command', ['userId', 'browserSessionId', 'commandId'], {
        unique: true,
        name: 'maxun_control_command_replay_unique',
      });
    }
    if (!indexes.some(index => index.name === 'maxun_control_command_epoch_idx')) {
      await queryInterface.addIndex('maxun_control_command', ['userId', 'browserSessionId', 'controlEpoch'], {
        name: 'maxun_control_command_epoch_idx',
      });
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('maxun_control_command')) await queryInterface.dropTable('maxun_control_command');
    if (tables.includes('maxun_control_lease')) await queryInterface.dropTable('maxun_control_lease');
  },
};
