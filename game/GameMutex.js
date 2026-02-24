/**
 * Async mutex per game — prevents concurrent state transitions.
 * Replaces the simple boolean `_transitioning` flag with a proper queue.
 * 
 * Usage:
 *   const release = await gameMutex.acquire(channelId);
 *   try { ... } finally { release(); }
 */
class GameMutex {
  constructor() {
    /** @type {Map<string, Promise<void>>} */
    this._locks = new Map();
  }

  /**
   * Acquire an exclusive lock for a game channel.
   * If another operation holds the lock, this waits until it's released.
   * @param {string} channelId
   * @param {number} timeoutMs — auto-release safety (default 30s)
   * @returns {Promise<() => void>} release function
   */
  acquire(channelId, timeoutMs = 30000) {
    let release;
    const prev = this._locks.get(channelId) || Promise.resolve();

    const next = new Promise((resolve) => {
      release = resolve;
    });

    // Chain: wait for previous lock, then hold this one
    const ticket = prev.then(() => {
      // Safety timeout — auto-release if holder forgets/crashes
      const timer = setTimeout(() => {
        release();
      }, timeoutMs);

      return () => {
        clearTimeout(timer);
        release();
      };
    });

    // Store the next promise so future acquires wait for this one
    this._locks.set(channelId, next);

    return ticket;
  }

  /**
   * Check if a lock is currently held (non-blocking).
   * @param {string} channelId
   * @returns {boolean}
   */
  isLocked(channelId) {
    return this._locks.has(channelId);
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
  }
}

module.exports = new GameMutex();
module.exports.GameMutex = GameMutex;
