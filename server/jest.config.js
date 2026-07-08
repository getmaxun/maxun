const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  rootDir: __dirname,
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/**/__tests__/**/*.test.ts'],
  testTimeout: 15000,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: path.join(__dirname, 'tsconfig.test.json') }],
  },
};
