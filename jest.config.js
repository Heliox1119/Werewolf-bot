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
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60
    }
  },
  testTimeout: 10000,
  verbose: true
};
