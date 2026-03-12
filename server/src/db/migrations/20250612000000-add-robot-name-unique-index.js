'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX robot_user_name_unique
      ON robot ("userId", lower(trim(recording_meta->>'name')))
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS robot_user_name_unique
    `);
  }
};
