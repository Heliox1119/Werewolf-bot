/**
 * Concurrency utilities — Werewolf bot
 *
 * Zero-dependency helpers for controlled parallel execution of async work.
 * Designed for Discord API call batching: prevents rate-limit stacking
 * while still being faster than pure sequential execution.
 *
 * Usage:
 *   const { mapConcurrent } = require('../utils/concurrency');
 *
 *   // Process 20 channels with max 3 in flight at once
 *   const results = await mapConcurrent(channelIds, async (id) => {
 *     const ch = await guild.channels.fetch(id);
 *     await ch.permissionOverwrites.set(perms);
 *     return ch;
 *   }, 3);
 */

'use strict';

/**
 * Execute an async function over an array of items with bounded concurrency.
 *
 * Unlike Promise.all (unbounded) or sequential for-of (concurrency=1),
 * this processes up to `concurrency` items simultaneously — ideal for
 * Discord API calls where the per-route rate limit is typically 5/5s.
 *
 * Semantics:
 *   - Items are processed in order of submission (FIFO).
 *   - All items are attempted even if some reject (unless `stopOnError` is true).
 *   - Results array preserves input order (like Promise.all).
 *   - Rejections are collected; a single AggregateError is thrown at the end
 *     if any item failed (unless `swallowErrors` is true).
 *
 * @template T, R
 * @param {T[]}                   items       - Items to process
 * @param {(item: T, index: number) => Promise<R>} fn - Async worker
 * @param {number}                [concurrency=3] - Max parallel operations (≥1)
 * @param {object}                [opts]
 * @param {boolean}               [opts.stopOnError=false] - Abort remaining on first error
 * @param {boolean}               [opts.swallowErrors=false] - Return partial results instead of throwing
 * @returns {Promise<R[]>}        Results in input order
 */
async function mapConcurrent(items, fn, concurrency = 3, opts = {}) {
  if (!Array.isArray(items)) throw new TypeError('mapConcurrent: items must be an array');
  if (typeof fn !== 'function') throw new TypeError('mapConcurrent: fn must be a function');
  concurrency = Math.max(1, Math.floor(concurrency));

  const { stopOnError = false, swallowErrors = false } = opts;

  if (items.length === 0) return [];

  const results = new Array(items.length);
  const errors = [];
  let nextIndex = 0;
  let stopped = false;

  async function worker() {
    while (!stopped) {
      const idx = nextIndex++;
      if (idx >= items.length) break;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (err) {
        errors.push({ index: idx, error: err });
        if (stopOnError) {
          stopped = true;
          break;
        }
      }
    }
  }

  // Spawn `concurrency` workers — each pulls from the shared index counter
  const workerCount = Math.min(concurrency, items.length);
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (errors.length > 0 && !swallowErrors) {
    const agg = new Error(
      `mapConcurrent: ${errors.length}/${items.length} item(s) failed — ` +
      errors.map(e => `[${e.index}] ${e.error.message || e.error}`).join('; ')
    );
    agg.errors = errors;
    agg.partialResults = results;
    throw agg;
  }

  return results;
}

module.exports = { mapConcurrent };
