module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'game/**/*.js',
    'commands/**/*.js',
    'utils/**/*.js',
    '!**/node_modules/**',
    '!**/tests/**'
  ],
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  moduleNameMapper: {
    '^../database/db$': '<rootDir>/tests/__mocks__/database/db.js',
    '^../../database/db$': '<rootDir>/tests/__mocks__/database/db.js',
    '^../../../database/db$': '<rootDir>/tests/__mocks__/database/db.js'
  },
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0
    }
  },
  testTimeout: 10000,
  verbose: true
};
