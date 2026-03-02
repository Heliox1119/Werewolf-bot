/**
 * Centralized structured logging — Werewolf bot
 *
 * Architecture:
 *   - Structured events (stable uppercase names, not free text)
 *   - Levels: TRACE < DEBUG < INFO < WARN < ERROR < FATAL
 *   - Human-readable console (colored level only) + JSON mode
 *   - Async context propagation (requestId, guildId, …)
 *   - Scoped loggers via child()
 *   - Audit trail for critical game actions
 *   - Performance timing with durationMs
 *
 * Usage:
 *   const logger = require('./utils/logger');
 *
 *   // Pre-built scoped logger
 *   const { game: log } = require('./utils/logger');
 *   log.info('GAME_STARTED', { players: 7 });
 *
 *   // Custom scoped logger
 *   const log = logger.child('MY_SCOPE');
 *   log.info('SOMETHING_HAPPENED', { key: 'value' });
 *
 *   // With context (merges into all subsequent logs)
 *   const ctxLog = log.withContext({ guildId: '…', gameId: '…' });
 *   ctxLog.info('EVENT', { data: 1 });
 *
 *   // Async context propagation (automatic requestId)
 *   await logger.runWithContext({ requestId: logger.rid() }, async () => {
 *     log.info('EVENT'); // automatically includes requestId
 *   });
 *
 *   // Audit trail
 *   log.audit('CAPTAIN_ELECTED', { captainId: '…' });
 *
 *   // Performance timing
 *   const t = log.startTimer('phaseResolve');
 *   // … work …
 *   t.end('PHASE_RESOLVED', { from: 'NIGHT', to: 'DAY' }); // adds durationMs
 *
 * Environment:
 *   LOG_LEVEL  — TRACE|DEBUG|INFO|WARN|ERROR|FATAL|NONE  (default: INFO)
 *   LOG_JSON   — "true" for machine-readable JSON lines   (default: false)
 *   NODE_ENV   — "test" disables file writes
 *
 * Console human format:
 *   [2026-03-02T19:00:08.566Z] INFO  GAME  GAME_STARTED
 *   {
 *     "players": 7
 *   }
 *
 * JSON format:
 *   {"timestamp":"…","level":"INFO","scope":"GAME","event":"GAME_STARTED",
 *    "requestId":"…","guildId":"…","meta":{"players":7}}
 */
'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('crypto');
const chalk  = require('chalk');
const fs     = require('fs');
const path   = require('path');

// ─── Log levels ────────────────────────────────────────────────────
const LEVELS = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4, FATAL: 5, NONE: 6 };

const CURRENT_LEVEL = (() => {
  const env = (process.env.LOG_LEVEL || '').toUpperCase();
  return LEVELS[env] ?? LEVELS.INFO;
})();

const LOG_JSON = process.env.LOG_JSON === 'true';
const IS_TEST = process.env.NODE_ENV === 'test';

// ─── Level display (human) ─────────────────────────────────────────
const LEVEL_COLORS = {
  TRACE: chalk.gray,
  DEBUG: chalk.cyan,
  INFO:  chalk.blue,
  WARN:  chalk.yellow,
  ERROR: chalk.red,
  FATAL: chalk.bgRed.white.bold,
};

const LEVEL_PAD = {
  TRACE: 'TRACE', DEBUG: 'DEBUG', INFO: 'INFO ', WARN: 'WARN ',
  ERROR: 'ERROR', FATAL: 'FATAL',
};

// ─── Async context (requestId, guildId, …) ─────────────────────────
const _asyncCtx = new AsyncLocalStorage();

function _getAsyncContext() {
  return _asyncCtx.getStore() || {};
}

/**
 * Run `fn` with the given context merged into the current async context.
 * All logger calls inside `fn` automatically inherit these values.
 */
function runWithContext(ctx, fn) {
  const parent = _asyncCtx.getStore() || {};
  return _asyncCtx.run({ ...parent, ...ctx }, fn);
}

/** Generate a short unique request / correlation ID. */
function rid() {
  try { return crypto.randomUUID(); }
  catch { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
}

// ─── File logging with rotation ────────────────────────────────────
const LOGS_DIR      = path.join(__dirname, '..', 'logs');
const MAX_LOG_SIZE  = 5 * 1024 * 1024; // 5 MB
const MAX_LOG_FILES = 5;

if (!IS_TEST) {
  try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch { /* ignore */ }
}

function _rotate(basename) {
  try {
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const older = path.join(LOGS_DIR, `${basename}.${i}`);
      const newer = i === 1
        ? path.join(LOGS_DIR, basename)
        : path.join(LOGS_DIR, `${basename}.${i - 1}`);
      if (fs.existsSync(newer)) {
        if (i === MAX_LOG_FILES - 1 && fs.existsSync(older)) fs.unlinkSync(older);
        fs.renameSync(newer, older);
      }
    }
  } catch { /* best-effort */ }
}

function _appendFile(basename, line) {
  if (IS_TEST) return;
  try {
    const fp = path.join(LOGS_DIR, basename);
    if (fs.existsSync(fp) && fs.statSync(fp).size >= MAX_LOG_SIZE) _rotate(basename);
    fs.appendFileSync(fp, line + '\n', 'utf-8');
  } catch { /* never crash */ }
}

// ─── Safe JSON (circular-reference safe) ───────────────────────────
function _safe(obj, indent) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(obj, (_key, value) => {
      if (typeof value === 'bigint') return value.toString();
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    }, indent);
  } catch { return String(obj); }
}

// ─── Error / meta normalization ────────────────────────────────────
function _normalizeMeta(meta) {
  if (meta == null) return null;
  if (meta instanceof Error) {
    const o = { message: meta.message };
    if (meta.code !== undefined) o.code = meta.code;
    if (meta.stack) o.stack = meta.stack;
    return { error: o };
  }
  if (typeof meta !== 'object') return { value: meta };
  return meta;
}

// Context keys promoted to top-level in JSON output
const CTX_TOP = new Set([
  'requestId', 'guildId', 'channelId', 'gameId', 'userId', 'phase',
]);

// ─── Core log function ─────────────────────────────────────────────
function _log(level, scope, event, meta, explicitCtx) {
  if ((LEVELS[level] ?? LEVELS.INFO) < CURRENT_LEVEL) return;

  try {
    const ts   = new Date().toISOString();
    const aCtx = _getAsyncContext();
    const ctx  = explicitCtx ? { ...aCtx, ...explicitCtx } : { ...aCtx };
    const norm = _normalizeMeta(meta);

    // ── JSON mode ───────────────────────────────────────────────
    if (LOG_JSON) {
      const rec = { timestamp: ts, level, scope, event };
      for (const k of CTX_TOP) { if (ctx[k] !== undefined) rec[k] = ctx[k]; }
      for (const [k, v] of Object.entries(ctx)) {
        if (!CTX_TOP.has(k) && !k.startsWith('_') && rec[k] === undefined) rec[k] = v;
      }
      if (norm) rec.meta = norm;

      const line = _safe(rec);
      if (level === 'ERROR' || level === 'FATAL') console.error(line);
      else if (level === 'WARN') console.warn(line);
      else console.log(line);

      _appendFile('app.log', line);
      if (level === 'ERROR' || level === 'FATAL') _appendFile('error.log', line);
      return;
    }

    // ── Human mode ──────────────────────────────────────────────
    const colorFn = LEVEL_COLORS[level] || (s => s);
    const padded  = LEVEL_PAD[level] || level.padEnd(5);

    const display = {};
    for (const [k, v] of Object.entries(ctx)) {
      if (v !== undefined && !k.startsWith('_')) display[k] = v;
    }
    if (norm) { for (const [k, v] of Object.entries(norm)) display[k] = v; }

    const hasData = Object.keys(display).length > 0;
    const dataStr = hasData ? '\n' + _safe(display, 2) : '';

    const pretty = `[${ts}] ${colorFn(padded)}  ${scope}  ${event}${dataStr}`;
    const plain  = `[${ts}] ${padded}  ${scope}  ${event}${dataStr}`;

    if (level === 'ERROR' || level === 'FATAL') console.error(pretty);
    else if (level === 'WARN') console.warn(pretty);
    else console.log(pretty);

    _appendFile('app.log', plain);
    if (level === 'ERROR' || level === 'FATAL') _appendFile('error.log', plain);
  } catch { /* logger must never throw */ }
}

// ─── ScopedLogger ──────────────────────────────────────────────────
class ScopedLogger {
  constructor(scope, context) {
    this._scope = scope;
    this._ctx   = context || {};
  }

  trace(event, meta) { _log('TRACE', this._scope, event, meta, this._ctx); }
  debug(event, meta) { _log('DEBUG', this._scope, event, meta, this._ctx); }
  info(event, meta)  { _log('INFO',  this._scope, event, meta, this._ctx); }
  warn(event, meta)  { _log('WARN',  this._scope, event, meta, this._ctx); }
  error(event, meta) { _log('ERROR', this._scope, event, meta, this._ctx); }
  fatal(event, meta) { _log('FATAL', this._scope, event, meta, this._ctx); }

  /** @deprecated Use info() — kept temporarily for migration safety */
  success(event, meta) { _log('INFO', this._scope, event, meta, this._ctx); }
  /** @deprecated Use fatal() — kept temporarily for migration safety */
  critical(event, meta) { _log('FATAL', this._scope, event, meta, this._ctx); }

  /**
   * Audit trail — logs at INFO + writes to audit.log.
   * Use for critical game actions (captain elected, player killed, …).
   */
  audit(event, meta) {
    _log('INFO', this._scope, event, meta, { ...this._ctx, _audit: true });
    try {
      const ts   = new Date().toISOString();
      const aCtx = _getAsyncContext();
      const ctx  = { ...aCtx, ...this._ctx };
      const norm = _normalizeMeta(meta);
      const all  = { ...ctx };
      delete all._audit;
      if (norm) Object.assign(all, norm);
      const plain = `[${ts}] AUDIT  ${this._scope}  ${event}${
        Object.keys(all).length ? '\n' + _safe(all, 2) : ''
      }`;
      _appendFile('audit.log', plain);
    } catch { /* never crash */ }
  }

  /** Return a new ScopedLogger with merged context. */
  withContext(ctx) {
    return new ScopedLogger(this._scope, { ...this._ctx, ...ctx });
  }

  /**
   * Start a performance timer.
   * @param {string} label  Human label (used as fallback event name).
   * @returns {{ end(event?, meta?): number }}
   */
  startTimer(label) {
    const start = Date.now();
    const self  = this;
    return {
      end(event, meta) {
        const ms = Date.now() - start;
        self.debug(
          event || `TIMER_${(label || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
          { ...(meta || {}), durationMs: ms },
        );
        return ms;
      },
    };
  }
}

// ─── Interaction meta helper ───────────────────────────────────────
function interactionMeta(interaction) {
  if (!interaction) return {};
  const m = { userId: interaction.user?.id };
  if (typeof interaction.isChatInputCommand === 'function' && interaction.isChatInputCommand()) {
    m.type = 'slash'; m.command = interaction.commandName;
  } else if (typeof interaction.isButton === 'function' && interaction.isButton()) {
    m.type = 'button'; m.customId = interaction.customId;
  } else if (typeof interaction.isStringSelectMenu === 'function' && interaction.isStringSelectMenu()) {
    m.type = 'select'; m.customId = interaction.customId;
  } else if (typeof interaction.isModalSubmit === 'function' && interaction.isModalSubmit()) {
    m.type = 'modal'; m.customId = interaction.customId;
  } else {
    m.type = interaction.commandName ? 'slash' : 'component';
    m.customId = interaction.customId || interaction.commandName || 'N/A';
  }
  m.channelId = interaction.channelId;
  return m;
}

// ─── Factory ───────────────────────────────────────────────────────
function child(scope, ctx) { return new ScopedLogger(scope, ctx); }

// ─── Pre-built scoped loggers ──────────────────────────────────────
const _scoped = {
  app:         child('APP'),
  game:        child('GAME'),
  commands:    child('COMMANDS'),
  voice:       child('VOICE'),
  interaction: child('INTERACTION'),
  discord:     child('DISCORD'),
  db:          child('DB'),
  web:         child('WEB'),
  monitoring:  child('MONITORING'),
  phase:       child('PHASE'),
};

// ─── Public API ────────────────────────────────────────────────────
module.exports = {
  // Direct API  (scope, event, meta)
  trace: (scope, event, meta) => _log('TRACE', scope, event, meta),
  debug: (scope, event, meta) => _log('DEBUG', scope, event, meta),
  info:  (scope, event, meta) => _log('INFO',  scope, event, meta),
  warn:  (scope, event, meta) => _log('WARN',  scope, event, meta),
  error: (scope, event, meta) => _log('ERROR', scope, event, meta),
  fatal: (scope, event, meta) => _log('FATAL', scope, event, meta),

  // Factories
  child,
  scope: child,
  createLogger: child,

  // Context
  withContext: (ctx) => new ScopedLogger('APP', ctx),
  runWithContext,

  // Helpers
  interactionMeta,
  rid,
  generateRequestId: rid,

  // Constants
  LEVELS,
  LogLevel: LEVELS,

  // Pre-built scoped loggers
  ..._scoped,
};
