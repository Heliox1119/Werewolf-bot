/**
 * Shared logger mock factory for tests.
 *
 * Usage in test files:
 *   jest.mock('../../utils/logger', () => require('../helpers/loggerMock')());
 *   // or for deeper paths:
 *   jest.mock('../../../utils/logger', () => require('../../helpers/loggerMock')());
 */
'use strict';

function createLoggerMock() {
  const _scoped = () => {
    const s = {
      trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
      error: jest.fn(), fatal: jest.fn(),
      // deprecated aliases (kept for migration safety)
      success: jest.fn(), critical: jest.fn(),
      audit: jest.fn(),
      startTimer: jest.fn(() => ({ end: jest.fn(() => 0) })),
    };
    s.withContext = jest.fn(() => s);
    return s;
  };

  return {
    // Pre-built scoped loggers
    app: _scoped(), game: _scoped(), commands: _scoped(), voice: _scoped(),
    interaction: _scoped(), discord: _scoped(), db: _scoped(), web: _scoped(),
    monitoring: _scoped(), phase: _scoped(),

    // Factories
    child: jest.fn(() => _scoped()),
    scope: jest.fn(() => _scoped()),
    createLogger: jest.fn(() => _scoped()),

    // Context
    withContext: jest.fn(() => _scoped()),
    runWithContext: jest.fn((_ctx, fn) => fn()),

    // Helpers
    interactionMeta: (i) => ({
      type: 'test', userId: i?.user?.id, channelId: i?.channelId,
    }),
    rid: jest.fn(() => 'test-request-id'),
    generateRequestId: jest.fn(() => 'test-request-id'),

    // Constants
    LEVELS: { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4, FATAL: 5, NONE: 6 },
    LogLevel: { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4, FATAL: 5, NONE: 6 },

    // Direct API
    trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), fatal: jest.fn(),
  };
}

module.exports = createLoggerMock;
