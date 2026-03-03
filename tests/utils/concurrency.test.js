/**
 * Tests for utils/concurrency.js — mapConcurrent
 */
const { mapConcurrent } = require('../../utils/concurrency');

describe('mapConcurrent', () => {
  // ─── Input validation ──────────────────────────────────────────
  test('throws TypeError on non-array items', async () => {
    await expect(mapConcurrent('not-array', async () => {})).rejects.toThrow('items must be an array');
  });

  test('throws TypeError on non-function fn', async () => {
    await expect(mapConcurrent([1], 'not-fn')).rejects.toThrow('fn must be a function');
  });

  test('returns [] for empty array', async () => {
    const result = await mapConcurrent([], async (x) => x * 2);
    expect(result).toEqual([]);
  });

  // ─── Basic functionality ───────────────────────────────────────
  test('processes all items and preserves input order', async () => {
    const result = await mapConcurrent([1, 2, 3, 4, 5], async (x) => x * 10, 2);
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  test('passes index as second argument', async () => {
    const indices = [];
    await mapConcurrent(['a', 'b', 'c'], async (item, idx) => { indices.push(idx); }, 1);
    expect(indices).toEqual([0, 1, 2]);
  });

  test('single item works', async () => {
    const result = await mapConcurrent([42], async (x) => x + 1);
    expect(result).toEqual([43]);
  });

  // ─── Concurrency enforcement ──────────────────────────────────
  test('respects concurrency limit', async () => {
    let active = 0;
    let peakActive = 0;
    const concurrency = 2;

    await mapConcurrent(Array.from({ length: 10 }, (_, i) => i), async () => {
      active++;
      peakActive = Math.max(peakActive, active);
      await new Promise(r => setTimeout(r, 10));
      active--;
    }, concurrency);

    expect(peakActive).toBeLessThanOrEqual(concurrency);
    expect(peakActive).toBeGreaterThan(0);
  });

  test('concurrency 1 processes sequentially', async () => {
    const order = [];
    await mapConcurrent([1, 2, 3], async (x) => {
      order.push(`start-${x}`);
      await new Promise(r => setTimeout(r, 5));
      order.push(`end-${x}`);
    }, 1);
    // With concurrency 1, each item finishes before next starts
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
  });

  test('concurrency larger than items is fine', async () => {
    const result = await mapConcurrent([1, 2], async (x) => x, 100);
    expect(result).toEqual([1, 2]);
  });

  test('concurrency clamped to 1 for invalid values', async () => {
    const result = await mapConcurrent([10], async (x) => x, 0);
    expect(result).toEqual([10]);
  });

  // ─── Error handling ────────────────────────────────────────────
  test('collects errors and throws AggregateError by default', async () => {
    const fn = async (x) => {
      if (x === 2) throw new Error('boom');
      return x;
    };
    await expect(mapConcurrent([1, 2, 3], fn, 3)).rejects.toThrow('1/3 item(s) failed');
  });

  test('thrown error includes partialResults', async () => {
    try {
      await mapConcurrent([1, 2, 3], async (x) => {
        if (x === 2) throw new Error('fail');
        return x * 10;
      }, 3);
    } catch (err) {
      expect(err.partialResults[0]).toBe(10);
      expect(err.partialResults[2]).toBe(30);
      expect(err.errors).toHaveLength(1);
      expect(err.errors[0].index).toBe(1);
    }
  });

  test('swallowErrors returns partial results without throwing', async () => {
    const result = await mapConcurrent([1, 2, 3], async (x) => {
      if (x === 2) throw new Error('ignored');
      return x;
    }, 2, { swallowErrors: true });
    expect(result[0]).toBe(1);
    expect(result[1]).toBeUndefined(); // failed slot
    expect(result[2]).toBe(3);
  });

  test('stopOnError aborts remaining items', async () => {
    const processed = [];
    try {
      await mapConcurrent([1, 2, 3, 4, 5], async (x) => {
        processed.push(x);
        if (x === 2) throw new Error('stop');
        await new Promise(r => setTimeout(r, 20));
        return x;
      }, 1, { stopOnError: true });
    } catch (err) {
      // With concurrency 1, items after the error should not be processed
      expect(processed).toEqual([1, 2]);
    }
  });

  // ─── Real-world patterns ──────────────────────────────────────
  test('handles async operations that resolve at different speeds', async () => {
    const delays = [30, 10, 20, 5, 15];
    const result = await mapConcurrent(delays, async (delay, idx) => {
      await new Promise(r => setTimeout(r, delay));
      return idx;
    }, 3);
    // Results must be in input order regardless of completion order
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });
});
