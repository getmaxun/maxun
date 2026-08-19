'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('maxun_resource_claim', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      resourceType: {
        type: Sequelize.STRING(32),
        allowNull: false,
      },
      resourceId: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      ownerSessionId: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      epoch: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.addIndex('maxun_resource_claim', ['userId', 'resourceType', 'resourceId'], {
      unique: true,
      name: 'maxun_resource_claim_owner_unique',
    });
    await queryInterface.addIndex('maxun_resource_claim', ['userId', 'ownerSessionId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('maxun_resource_claim');
  },
};
