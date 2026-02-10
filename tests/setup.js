// Global test setup
process.env.NODE_ENV = 'test';
process.env.TOKEN = 'test-token-123';
process.env.CLIENT_ID = '123456789';
process.env.GUILD_ID = '987654321';

// Suppress console logs in tests unless VERBOSE is set
if (!process.env.VERBOSE) {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});
