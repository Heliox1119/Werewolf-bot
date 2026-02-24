/**
 * Tests for GameMutex — async per-game locking
 */
const { GameMutex } = require('../../game/GameMutex');

describe('GameMutex', () => {
  let mutex;

  beforeEach(() => {
    mutex = new GameMutex();
  });

  afterEach(() => {
    mutex.destroy();
  });

  test('acquire returns a release function', async () => {
    const release = await mutex.acquire('ch1');
    expect(typeof release).toBe('function');
    release();
  });

  test('sequential acquires work correctly', async () => {
    const release1 = await mutex.acquire('ch1');
    release1();
    const release2 = await mutex.acquire('ch1');
    release2();
  });

  test('different channels are independent', async () => {
    const release1 = await mutex.acquire('ch1');
    const release2 = await mutex.acquire('ch2');
    expect(typeof release1).toBe('function');
    expect(typeof release2).toBe('function');
    release1();
    release2();
  });

  test('concurrent acquires on same channel serialize', async () => {
    const order = [];

    const release1 = await mutex.acquire('ch1');
    order.push('acquired-1');

    // Start second acquire — it should wait
    const promise2 = mutex.acquire('ch1').then(release => {
      order.push('acquired-2');
      return release;
    });

    // Give event loop a tick — second acquire should NOT resolve yet
    await new Promise(r => setTimeout(r, 10));
    expect(order).toEqual(['acquired-1']);

    // Release first — now second should proceed
    release1();
    const release2 = await promise2;
    expect(order).toEqual(['acquired-1', 'acquired-2']);
    release2();
  });

  test('isLocked returns true when lock is held', async () => {
    const release = await mutex.acquire('ch1');
    expect(mutex.isLocked('ch1')).toBe(true);
    release();
  });

  test('isLocked returns false for unknown channel', () => {
    expect(mutex.isLocked('unknown')).toBe(false);
  });

  test('delete removes a lock entry', async () => {
    await mutex.acquire('ch1');
    mutex.delete('ch1');
    expect(mutex.isLocked('ch1')).toBe(false);
  });

  test('destroy clears all locks', async () => {
    await mutex.acquire('ch1');
    await mutex.acquire('ch2');
    mutex.destroy();
    expect(mutex.isLocked('ch1')).toBe(false);
    expect(mutex.isLocked('ch2')).toBe(false);
  });

  test('auto-releases after timeout', async () => {
    const order = [];

    // Acquire with very short timeout
    const release1 = await mutex.acquire('ch1', 50);
    order.push('acquired-1');

    // Intentionally do NOT release — rely on timeout
    const promise2 = mutex.acquire('ch1', 5000).then(release => {
      order.push('acquired-2');
      return release;
    });

    // Wait for timeout to kick in
    await new Promise(r => setTimeout(r, 100));
    const release2 = await promise2;
    expect(order).toEqual(['acquired-1', 'acquired-2']);
    release2();
  }, 5000);

  test('three concurrent acquires serialize in order', async () => {
    const order = [];

    const release1 = await mutex.acquire('ch1');
    order.push(1);

    const promise2 = mutex.acquire('ch1').then(r => { order.push(2); return r; });
    const promise3 = mutex.acquire('ch1').then(r => { order.push(3); return r; });

    release1();
    const release2 = await promise2;
    release2();
    const release3 = await promise3;
    release3();

    expect(order).toEqual([1, 2, 3]);
  });
});
