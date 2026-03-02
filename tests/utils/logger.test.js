/**
 * Tests for utils/logger.js — structured logging system
 */
'use strict';

process.env.NODE_ENV = 'test';

// Dynamically reset LOG_LEVEL / LOG_JSON between tests via isolateModules
function loadLogger(env = {}) {
  let mod;
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  jest.isolateModules(() => { mod = require('../../utils/logger'); });
  for (const [k] of Object.entries(env)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  return mod;
}

// Default logger (INFO level, human mode)
const logger = require('../../utils/logger');

beforeEach(() => jest.restoreAllMocks());

// ─── Exports ────────────────────────────────────────────────────────

describe('exports', () => {
  test('direct API methods (scope, event, meta)', () => {
    for (const m of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      expect(typeof logger[m]).toBe('function');
    }
  });

  test('factory functions', () => {
    expect(typeof logger.child).toBe('function');
    expect(typeof logger.scope).toBe('function');
    expect(typeof logger.createLogger).toBe('function');
    expect(logger.scope).toBe(logger.child);
  });

  test('context helpers', () => {
    expect(typeof logger.withContext).toBe('function');
    expect(typeof logger.runWithContext).toBe('function');
  });

  test('interactionMeta helper', () => {
    expect(typeof logger.interactionMeta).toBe('function');
  });

  test('rid / generateRequestId', () => {
    expect(typeof logger.rid).toBe('function');
    expect(typeof logger.generateRequestId).toBe('function');
    expect(logger.generateRequestId).toBe(logger.rid);
  });

  test('LEVELS constant', () => {
    expect(logger.LEVELS).toEqual({
      TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4, FATAL: 5, NONE: 6,
    });
  });

  test('LogLevel backward compat', () => {
    expect(logger.LogLevel).toBe(logger.LEVELS);
  });

  test('pre-built scoped loggers', () => {
    const SCOPES = ['app', 'game', 'commands', 'voice', 'interaction', 'discord', 'db', 'web', 'monitoring', 'phase'];
    for (const name of SCOPES) {
      expect(logger[name]).toBeDefined();
      for (const m of ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'audit', 'withContext', 'startTimer']) {
        expect(typeof logger[name][m]).toBe('function');
      }
    }
  });

  test('deprecated aliases on scoped loggers', () => {
    expect(typeof logger.app.success).toBe('function');
    expect(typeof logger.app.critical).toBe('function');
  });
});

// ─── ScopedLogger basic usage ───────────────────────────────────────

describe('ScopedLogger', () => {
  test('child() returns a logger with scope', () => {
    const log = logger.child('TEST');
    for (const m of ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'audit', 'withContext', 'startTimer']) {
      expect(typeof log[m]).toBe('function');
    }
  });

  test('info() writes to console.log', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    logger.app.info('TEST_EVENT', { key: 'value' });
    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0];
    expect(output).toContain('APP');
    expect(output).toContain('TEST_EVENT');
  });

  test('warn() writes to console.warn', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    logger.app.warn('WARN_EVENT');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('WARN_EVENT');
  });

  test('error() writes to console.error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    logger.app.error('ERR_EVENT');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('ERR_EVENT');
  });

  test('fatal() writes to console.error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    logger.app.fatal('FATAL_EVENT');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('FATAL_EVENT');
  });

  test('success() is alias for info()', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    logger.app.success('SUCCESS_EVENT');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('SUCCESS_EVENT');
  });

  test('critical() is alias for fatal()', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    logger.app.critical('CRIT_EVENT');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('CRIT_EVENT');
  });
});

// ─── Level filtering ────────────────────────────────────────────────

describe('level filtering', () => {
  test('default level is INFO — trace/debug are suppressed', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const errSpy = jest.spyOn(console, 'error').mockImplementation();

    logger.app.trace('TRACE_EVENT');
    logger.app.debug('DEBUG_EVENT');
    logger.app.info('INFO_EVENT');
    logger.app.warn('WARN_EVENT');
    logger.app.error('ERROR_EVENT');

    // trace + debug suppressed at INFO level
    expect(logSpy).toHaveBeenCalledTimes(1); // only info
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  test('LOG_LEVEL=TRACE shows everything', () => {
    const lg = loadLogger({ LOG_LEVEL: 'TRACE' });
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    lg.app.trace('T');
    lg.app.debug('D');
    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  test('LOG_LEVEL=ERROR suppresses info and warn', () => {
    const lg = loadLogger({ LOG_LEVEL: 'ERROR' });
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const errSpy = jest.spyOn(console, 'error').mockImplementation();

    lg.app.info('I');
    lg.app.warn('W');
    lg.app.error('E');

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  test('LOG_LEVEL=NONE suppresses everything', () => {
    const lg = loadLogger({ LOG_LEVEL: 'NONE' });
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const errSpy = jest.spyOn(console, 'error').mockImplementation();

    lg.app.trace('T');
    lg.app.debug('D');
    lg.app.info('I');
    lg.app.warn('W');
    lg.app.error('E');
    lg.app.fatal('F');

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });
});

// ─── withContext ─────────────────────────────────────────────────────

describe('withContext', () => {
  test('returns a new ScopedLogger with merged context', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    const log = logger.child('CTX');
    const ctxLog = log.withContext({ guildId: 'g123' });

    expect(ctxLog).not.toBe(log); // new instance
    ctxLog.info('CTX_EVENT');

    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0];
    expect(output).toContain('CTX_EVENT');
    expect(output).toContain('g123');
  });

  test('context chains merge correctly', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    const log = logger.child('CHAIN')
      .withContext({ guildId: 'g1' })
      .withContext({ channelId: 'c1' });

    log.info('CHAIN_EVENT');
    const output = spy.mock.calls[0][0];
    expect(output).toContain('g1');
    expect(output).toContain('c1');
  });
});

// ─── AsyncLocalStorage (runWithContext) ──────────────────────────────

describe('runWithContext', () => {
  test('propagates context to log calls inside fn', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();

    await logger.runWithContext({ requestId: 'req-42' }, async () => {
      logger.app.info('INSIDE_CONTEXT');
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0];
    expect(output).toContain('req-42');
  });

  test('nested runWithContext merges parent + child', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();

    await logger.runWithContext({ requestId: 'outer' }, async () => {
      await logger.runWithContext({ guildId: 'g1' }, async () => {
        logger.app.info('NESTED');
      });
    });

    const output = spy.mock.calls[0][0];
    expect(output).toContain('outer');
    expect(output).toContain('g1');
  });

  test('context is lost after runWithContext ends', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();

    await logger.runWithContext({ requestId: 'temp' }, async () => {});
    logger.app.info('OUTSIDE');

    const output = spy.mock.calls[0][0];
    expect(output).not.toContain('temp');
  });
});

// ─── startTimer ─────────────────────────────────────────────────────

describe('startTimer', () => {
  test('end() logs with durationMs and returns ms', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    const log = loadLogger({ LOG_LEVEL: 'TRACE' }).child('TMR');

    const timer = log.startTimer('myLabel');
    const ms = timer.end('TIMER_DONE', { extra: 1 });

    expect(typeof ms).toBe('number');
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0];
    expect(output).toContain('TIMER_DONE');
    expect(output).toContain('durationMs');
  });

  test('end() without event arg uses label-based fallback', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    const log = loadLogger({ LOG_LEVEL: 'TRACE' }).child('TMR');

    const timer = log.startTimer('phaseResolve');
    timer.end();

    const output = spy.mock.calls[0][0];
    expect(output).toContain('TIMER_PHASERESOLVE');
  });
});

// ─── audit ──────────────────────────────────────────────────────────

describe('audit', () => {
  test('audit() logs at INFO level', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    logger.game.audit('CAPTAIN_ELECTED', { captainId: 'p1' });
    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0];
    expect(output).toContain('CAPTAIN_ELECTED');
    expect(output).toContain('p1');
  });

  test('audit() does not write to file in test mode', () => {
    // File writes are disabled when NODE_ENV=test
    // This just ensures audit() doesn't throw
    expect(() => {
      logger.game.audit('AUDIT_EVENT', { key: 'val' });
    }).not.toThrow();
  });
});

// ─── interactionMeta ────────────────────────────────────────────────

describe('interactionMeta', () => {
  test('returns empty object for null', () => {
    expect(logger.interactionMeta(null)).toEqual({});
  });

  test('detects slash command', () => {
    const interaction = {
      isChatInputCommand: () => true,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      commandName: 'create',
      channelId: 'ch1',
      user: { id: 'u1' },
    };
    const meta = logger.interactionMeta(interaction);
    expect(meta.type).toBe('slash');
    expect(meta.command).toBe('create');
    expect(meta.userId).toBe('u1');
    expect(meta.channelId).toBe('ch1');
  });

  test('detects button', () => {
    const interaction = {
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: 'lobby_join:ch1',
      channelId: 'ch1',
      user: { id: 'u2' },
    };
    const meta = logger.interactionMeta(interaction);
    expect(meta.type).toBe('button');
    expect(meta.customId).toBe('lobby_join:ch1');
  });

  test('detects select menu', () => {
    const interaction = {
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => true,
      isModalSubmit: () => false,
      customId: 'wolves_kill',
      channelId: 'ch2',
      user: { id: 'u3' },
    };
    const meta = logger.interactionMeta(interaction);
    expect(meta.type).toBe('select');
    expect(meta.customId).toBe('wolves_kill');
  });

  test('detects modal submit', () => {
    const interaction = {
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      customId: 'my_modal',
      channelId: 'ch3',
      user: { id: 'u4' },
    };
    const meta = logger.interactionMeta(interaction);
    expect(meta.type).toBe('modal');
    expect(meta.customId).toBe('my_modal');
  });

  test('fallback for unknown interaction type', () => {
    const interaction = {
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: 'unknown_thing',
      channelId: 'ch4',
      user: { id: 'u5' },
    };
    const meta = logger.interactionMeta(interaction);
    expect(meta.type).toBe('component');
    expect(meta.customId).toBe('unknown_thing');
  });
});

// ─── rid / generateRequestId ────────────────────────────────────────

describe('rid', () => {
  test('generates a string', () => {
    const id = logger.rid();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('generates unique values', () => {
    const ids = new Set(Array.from({ length: 50 }, () => logger.rid()));
    expect(ids.size).toBe(50);
  });
});

// ─── Error normalization ────────────────────────────────────────────

describe('error normalization', () => {
  test('Error objects are structured in output', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    const err = new Error('test failure');
    err.code = 'ERR_TEST';
    logger.app.error('SOME_ERROR', err);

    const output = spy.mock.calls[0][0];
    expect(output).toContain('test failure');
    expect(output).toContain('ERR_TEST');
  });

  test('plain objects are passed through', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    logger.app.error('PLAIN_ERROR', { code: 50001, msg: 'Missing Access' });

    const output = spy.mock.calls[0][0];
    expect(output).toContain('50001');
    expect(output).toContain('Missing Access');
  });
});

// ─── JSON mode ──────────────────────────────────────────────────────

describe('JSON mode (LOG_JSON=true)', () => {
  test('outputs valid JSON', () => {
    const lg = loadLogger({ LOG_JSON: 'true' });
    const spy = jest.spyOn(console, 'log').mockImplementation();

    lg.app.info('JSON_EVENT', { players: 7 });

    const output = spy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('INFO');
    expect(parsed.scope).toBe('APP');
    expect(parsed.event).toBe('JSON_EVENT');
    expect(parsed.meta).toEqual({ players: 7 });
    expect(parsed.timestamp).toBeDefined();
  });

  test('context fields are top-level in JSON', () => {
    const lg = loadLogger({ LOG_JSON: 'true' });
    const spy = jest.spyOn(console, 'log').mockImplementation();

    const log = lg.child('J').withContext({ guildId: 'g1', channelId: 'c1' });
    log.info('TOP_LEVEL_CTX');

    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.guildId).toBe('g1');
    expect(parsed.channelId).toBe('c1');
  });

  test('errors go to console.error in JSON mode', () => {
    const lg = loadLogger({ LOG_JSON: 'true' });
    const spy = jest.spyOn(console, 'error').mockImplementation();

    lg.app.error('JSON_ERR');
    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.level).toBe('ERROR');
  });
});

// ─── Circular reference safety ──────────────────────────────────────

describe('circular reference handling', () => {
  test('does not throw on circular objects', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    const obj = { a: 1 };
    obj.self = obj;

    expect(() => {
      logger.app.info('CIRCULAR_TEST', obj);
    }).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('[Circular]');
  });
});

// ─── Crash safety ───────────────────────────────────────────────────

describe('crash safety', () => {
  test('never throws even with bizarre input', () => {
    expect(() => logger.app.info('E', undefined)).not.toThrow();
    expect(() => logger.app.info('E', null)).not.toThrow();
    expect(() => logger.app.info('E', 42)).not.toThrow();
    expect(() => logger.app.info('E', 'string')).not.toThrow();
    expect(() => logger.app.info('E', Symbol('s'))).not.toThrow();
  });

  test('direct API never throws', () => {
    expect(() => logger.info('SCOPE', 'EVENT', { x: 1 })).not.toThrow();
    expect(() => logger.error('SCOPE', 'EVENT', new Error('x'))).not.toThrow();
  });
});

// ─── Human output format ────────────────────────────────────────────

describe('human output format', () => {
  test('includes timestamp, level, scope, event', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    logger.app.info('FORMAT_TEST');

    const output = spy.mock.calls[0][0];
    // Timestamp pattern: [2026-...]
    expect(output).toMatch(/^\[.*\]/);
    expect(output).toContain('APP');
    expect(output).toContain('FORMAT_TEST');
  });

  test('meta displayed as indented JSON below the line', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    logger.app.info('META_TEST', { players: 3, mode: 'standard' });

    const output = spy.mock.calls[0][0];
    expect(output).toContain('"players": 3');
    expect(output).toContain('"mode": "standard"');
  });
});
