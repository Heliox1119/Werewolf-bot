/**
 * Async mutex per game — prevents concurrent state transitions.
 * Replaces the simple boolean `_transitioning` flag with a proper queue.
 * 
 * Usage:
 *   const release = await gameMutex.acquire(channelId);
 *   try { ... } finally { release(); }
 */
const { game: logger } = require('../utils/logger');

const LONG_HOLD_WARNING_MS = 5000;

class GameMutex {
  constructor() {
    /** @type {Map<string, { tail: Promise<void>, pending: number, active: boolean, currentLock: { acquiredAt: number, waitMs: number } | null }>} */
    this._locks = new Map();

    // Observability metrics
    this._waitSamples = 0;
    this._waitTotalMs = 0;
    this._maxWaitMs = 0;
    this._activeLocks = 0;
    this._maxQueueLength = 0;
    this._holdSamples = 0;
    this._holdTotalMs = 0;
  }

  _getOrCreateState(channelId) {
    let state = this._locks.get(channelId);
    if (!state) {
      state = {
        tail: Promise.resolve(),
        pending: 0,
        active: false,
        currentLock: null
      };
      this._locks.set(channelId, state);
    }
    return state;
  }

  _recordWait(waitMs) {
    this._waitSamples += 1;
    this._waitTotalMs += waitMs;
    if (waitMs > this._maxWaitMs) {
      this._maxWaitMs = waitMs;
    }
  }

  _recordHold(holdMs) {
    this._holdSamples += 1;
    this._holdTotalMs += holdMs;
  }

  /**
   * Acquire an exclusive lock for a game channel.
   * If another operation holds the lock, this waits until it's released.
   * @param {string} channelId
   * @param {number} timeoutMs — auto-release safety (default 30s)
   * @returns {Promise<() => void>} release function
   */
  acquire(channelId, timeoutMs = 30000) {
    const requestedAt = Date.now();
    const state = this._getOrCreateState(channelId);
    const prev = state.tail;

    state.pending += 1;
    if (state.pending > this._maxQueueLength) {
      this._maxQueueLength = state.pending;
    }

    let releaseResolver;

    const next = new Promise((resolve) => {
      releaseResolver = resolve;
    });

    state.tail = next;

    // Chain: wait for previous lock, then hold this one
    const ticket = prev.then(() => {
      const waitMs = Date.now() - requestedAt;
      this._recordWait(waitMs);

      state.pending = Math.max(0, state.pending - 1);
      state.active = true;
      this._activeLocks += 1;

      const acquiredAt = Date.now();
      state.currentLock = { acquiredAt, waitMs };
      let released = false;

      const doRelease = () => {
        if (released) return;
        released = true;

        clearTimeout(timer);

        const holdMs = Date.now() - acquiredAt;
        this._recordHold(holdMs);

        if (holdMs > LONG_HOLD_WARNING_MS) {
          logger.warn('GameMutex lock held too long', {
            channelId,
            holdMs,
            waitMs,
            queueLength: state.pending,
            timeoutMs
          });
        }

        state.active = false;
        state.currentLock = null;
        this._activeLocks = Math.max(0, this._activeLocks - 1);

        if (state.pending === 0 && !state.active) {
          this._locks.delete(channelId);
        }

        releaseResolver();
      };

      // Safety timeout — auto-release if holder forgets/crashes
      const timer = setTimeout(() => {
        doRelease();
      }, timeoutMs);

      return doRelease;
    });

    return ticket;
  }

  /**
   * Check if a lock is currently held (non-blocking).
   * @param {string} channelId
   * @returns {boolean}
   */
  isLocked(channelId) {
    const state = this._locks.get(channelId);
    if (!state) return false;
    return state.active || state.pending > 0;
  }

  getQueueLength(channelId = null) {
    if (channelId) {
      const state = this._locks.get(channelId);
      return state ? state.pending : 0;
    }

    let total = 0;
    for (const state of this._locks.values()) {
      total += state.pending;
    }
    return total;
  }

  getMetrics() {
    return {
      max_wait_ms: this._maxWaitMs,
      avg_wait_ms: this._waitSamples > 0 ? this._waitTotalMs / this._waitSamples : 0,
      active_locks: this._activeLocks,
      queue_length: this.getQueueLength(),
      max_queue_length: this._maxQueueLength,
      avg_hold_ms: this._holdSamples > 0 ? this._holdTotalMs / this._holdSamples : 0
    };
  }

  /**
   * Remove a lock entry (cleanup on game delete).
   * @param {string} channelId
   */
  delete(channelId) {
    this._locks.delete(channelId);
  }

  /**
   * Clear all locks (shutdown).
   */
  destroy() {
    this._locks.clear();
    this._waitSamples = 0;
    this._waitTotalMs = 0;
    this._maxWaitMs = 0;
    this._activeLocks = 0;
    this._maxQueueLength = 0;
    this._holdSamples = 0;
    this._holdTotalMs = 0;
  }
}

module.exports = new GameMutex();
module.exports.GameMutex = GameMutex;
